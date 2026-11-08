#!/bin/bash
#
# Proxy Manager, Linux Mint / Cinnamon port of tedacodder/proxy_manager.
# Usage: proxy-manager.sh <status|enable|disable [--no-check]|toggle|
#                          gateway-change|start-watcher|stop-watcher>
#
set -uo pipefail
exec </dev/null    # never let a child process wait on the caller's stdin

SELF="$(readlink -f "$0")"
SELF_DIR="$(dirname "$SELF")"

CONFIG_DIR="$HOME/.config/proxy-manager"
CONFIG_FILE="$CONFIG_DIR/proxy.json"
STATE_DIR="$CONFIG_DIR/state"
GATEWAY_FILE="$STATE_DIR/gateway"
ENV_DIR="$HOME/.config/environment.d"
PIP_CONF_DIR="$HOME/.config/pip"
CURLRC="$HOME/.curlrc"
BASHRC="$HOME/.bashrc"
VSCODE_SETTINGS="$HOME/.config/Code/User/settings.json"
USER_APPS="$HOME/.local/share/applications"
BIN_DIR="$HOME/.local/bin"
WRAPPER_SRC="$SELF_DIR/proxy-browser"
BROWSERS="google-chrome chromium chromium-browser brave-browser"
SYS_APPS="${PROXY_SYS_APPS:-/usr/share/applications}"
APT_HELPER="${PROXY_APT_HELPER:-/usr/local/libexec/proxy-manager-apt-helper}"
APT_MARKER="$STATE_DIR/apt-proxy"
WATCHER_PID_FILE="$STATE_DIR/gateway-watcher.pid"
WATCHER_SCRIPT="$STATE_DIR/gateway-watcher.sh"
ALL_INTEGRATIONS="env git npm yarn pip curl wget docker firefox system browser vscode apt"
DOCKER_CONF="$HOME/.docker/config.json"
APPLIED_FILE="$STATE_DIR/applied"     # integrations this applet turned on
FORCE=false                           # --force skips the gateway check

warn() { echo "warning: $*" >&2; }

# ------------------------------------------------------------------ config

default_gateway() {
    ip route show default 2>/dev/null |
        awk '$0 !~ /dev (tun|tap|wg)[0-9]*/ && $2 == "via" { print $3; exit }'
}

validate_config() {
    [[ -f $CONFIG_FILE ]] || return 0
    if ! jq -e '
        type == "object" and
        (.integrations == null or (.integrations | type == "array" and all(.[]; type == "string"))) and
        (.port == null or (.port | type == "number" or type == "string"))
    ' "$CONFIG_FILE" >/dev/null 2>&1; then
        warn "invalid proxy configuration: $CONFIG_FILE (expected a JSON object)"
        return 1
    fi
}

get_port() {
    local port=8080
    if [[ -f $CONFIG_FILE ]]; then
        validate_config || return 1
        port=$(jq -r '.port // 8080' "$CONFIG_FILE")
    fi
    if [[ $port =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )); then
        echo "$port"
    else
        echo 8080
    fi
}

detect_gateway_proxy() {
    local gw port
    gw=$(default_gateway)
    port=$(get_port) || port=8080
    echo "http://${gw:-127.0.0.1}:$port"
}

read_config() {
    if [[ ! -f $CONFIG_FILE ]]; then
        mkdir -p "$CONFIG_DIR"
        local url enabled=false
        url=$(detect_gateway_proxy)
        if git config --global --get http.proxy >/dev/null 2>&1 || [[ -f $ENV_DIR/proxy.conf ]]; then
            enabled=true
        fi
        jq -n --arg url "$url" --argjson enabled "$enabled" '{
            httpProxy: $url,
            httpsProxy: $url,
            noProxy: "localhost,127.0.0.1,::1",
            integrations: ["env","git","npm","yarn","pip","curl","browser","vscode","apt"],
            gatewayAuto: true,
            port: 8080,
            enabled: $enabled
        }' > "$CONFIG_FILE"
    fi
    validate_config || return 1
    cat "$CONFIG_FILE"
}

cfg_get() { read_config 2>/dev/null | jq -r "$1"; }

cfg_has_integration() {
    local name="$1" filter
    if [[ $name == apt ]]; then
        filter='(.integrations // []) | ((index("apt") != null) or (index("pacman") != null))'
    else
        filter="(.integrations // []) | index(\"$name\") != null"
    fi
    read_config 2>/dev/null | jq -e "$filter" >/dev/null 2>&1
}

with_config_lock() {
    mkdir -p "$CONFIG_DIR"
    if command -v flock >/dev/null 2>&1; then
        (
            flock -w 5 200 || warn "could not acquire config lock"
            "$@"
        ) 200>"$CONFIG_FILE.lock"
    else
        "$@"
    fi
}

# update_config FILTER [jq options...]  (read-modify-write under the lock)
_update_locked() {
    local filter="$1"; shift
    local cur tmp="$CONFIG_FILE.tmp.$$"
    cur=$(read_config) || return 1
    if printf '%s\n' "$cur" | jq "$@" "$filter" > "$tmp" && mv -f "$tmp" "$CONFIG_FILE"; then
        return 0
    fi
    rm -f "$tmp"
    return 1
}
update_config() { with_config_lock _update_locked "$@"; }

set_enabled_flag() { update_config '.enabled = $v' --argjson v "$1"; }

refresh_gateway_urls() {
    # Only an explicit false disables this; jq's // would treat false as missing.
    [[ "$(cfg_get '.gatewayAuto')" == "false" ]] && return 0
    local url
    url=$(detect_gateway_proxy)
    update_config '.httpProxy = $url | .httpsProxy = $url' --arg url "$url"
}

# Does a proxy answer at this URL? Only a 204 from the connectivity check counts.
gateway_answers() {
    local url="$1" out
    [[ -n $url ]] || return 1
    out=$(timeout 12 curl -s -o /dev/null -w '%{http_code} %{time_total}' \
        --proxy "$url" --max-time 8 http://connectivitycheck.gstatic.com/generate_204 2>/dev/null)
    [[ ${out%% *} == 204 ]]
}

# Which integrations this applet turned on (so disable undoes exactly those).
applied_has() { [[ -f $APPLIED_FILE ]] && grep -qx "$1" "$APPLIED_FILE"; }
remember_applied() {
    mkdir -p "$STATE_DIR"
    applied_has "$1" || printf '%s\n' "$1" >> "$APPLIED_FILE"
}
forget_applied() {
    [[ -f $APPLIED_FILE ]] || return 0
    grep -vx "$1" "$APPLIED_FILE" > "$APPLIED_FILE.tmp" 2>/dev/null
    mv -f "$APPLIED_FILE.tmp" "$APPLIED_FILE"
}

# Used when the proxy must be switched off automatically (for example, a gateway change).
turn_off_everything() {
    apply disable
    set_enabled_flag false
}

ensure_curl_integration() {
    cfg_has_integration curl && return 0
    update_config '.integrations += ["curl"]'
}

sed_escape() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }

# ------------------------------------------------------------ environment

install_bashrc_block() {
    local http="$1" https="$2" block
    block=$(mktemp)
    cat > "$block" <<'BASHRC_BLOCK'
# PROXY_SETTINGS
if [[ -f "$HOME/.config/environment.d/proxy.conf" ]]; then
    export HTTP_PROXY="__HTTP__"
    export HTTPS_PROXY="__HTTPS__"
    export http_proxy="__HTTP__"
    export https_proxy="__HTTPS__"
    export NODE_USE_ENV_PROXY=1
else
    unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY NODE_USE_ENV_PROXY 2>/dev/null || true
fi
# END_PROXY_SETTINGS
BASHRC_BLOCK
    sed -i "s|__HTTP__|$(sed_escape "$http")|g; s|__HTTPS__|$(sed_escape "$https")|g" "$block"

    # Prepend the block: Mint's default .bashrc has a non-interactive guard
    # ("case $- in *i*) ;; *) return;; esac") that would hide an appended block.
    [[ -f $BASHRC ]] || : > "$BASHRC"
    sed -i '/^# PROXY_SETTINGS$/,/^# END_PROXY_SETTINGS$/d' "$BASHRC"
    if { cat "$block"; cat "$BASHRC"; } > "$BASHRC.tmp.$$"; then
        mv -f "$BASHRC.tmp.$$" "$BASHRC"
    fi
    rm -f "$block" "$BASHRC.tmp.$$"
}

enable_env() {
    local http https no
    http=$(cfg_get '.httpProxy // empty')
    https=$(cfg_get '.httpsProxy // empty')
    no=$(cfg_get '.noProxy // empty')
    mkdir -p "$ENV_DIR"
    cat > "$ENV_DIR/proxy.conf" <<EOF
http_proxy=$http
https_proxy=$https
no_proxy=$no
HTTP_PROXY=$http
HTTPS_PROXY=$https
NO_PROXY=$no
EOF
    install_bashrc_block "$http" "$https"
    systemctl --user set-environment \
        http_proxy="$http" HTTP_PROXY="$http" \
        https_proxy="$https" HTTPS_PROXY="$https" \
        no_proxy="$no" NO_PROXY="$no" 2>/dev/null || true
    if command -v dbus-update-activation-environment >/dev/null 2>&1; then
        dbus-update-activation-environment --systemd \
            http_proxy="$http" HTTP_PROXY="$http" \
            https_proxy="$https" HTTPS_PROXY="$https" \
            no_proxy="$no" NO_PROXY="$no" 2>/dev/null || true
    fi
}

disable_env() {
    rm -f "$ENV_DIR/proxy.conf"
    if command -v dbus-update-activation-environment >/dev/null 2>&1; then
        dbus-update-activation-environment --systemd \
            http_proxy= HTTP_PROXY= https_proxy= HTTPS_PROXY= \
            no_proxy= NO_PROXY= NODE_USE_ENV_PROXY= 2>/dev/null || true
    fi
    if systemctl --user show-environment 2>/dev/null | grep -q '^http_proxy='; then
        systemctl --user set-environment http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= \
            no_proxy= NO_PROXY= NODE_USE_ENV_PROXY= 2>/dev/null || true
    fi
    install_bashrc_block "" ""
}

# -------------------------------------------------------------------- git

enable_git() {
    local url; url=$(cfg_get '.httpProxy // empty')
    [[ -n $url ]] || return 0
    git config --global http.proxy "$url"
    git config --global https.proxy "$url"
}
disable_git() {
    local ours; ours=$(cfg_get '.httpProxy // empty')
    # Only remove a value that is ours, so a proxy you set yourself survives.
    if [[ -z $ours || $(git config --global --get http.proxy 2>/dev/null) == "$ours" ]]; then
        git config --global --unset-all http.proxy 2>/dev/null || true
    fi
    if [[ -z $ours || $(git config --global --get https.proxy 2>/dev/null) == "$ours" ]]; then
        git config --global --unset-all https.proxy 2>/dev/null || true
    fi
}

# -------------------------------------------------------------- npm / yarn

enable_npm() {
    command -v npm >/dev/null 2>&1 || return 0
    npm config set proxy "$(cfg_get '.httpProxy // empty')" >/dev/null 2>&1 || true
    npm config set https-proxy "$(cfg_get '.httpsProxy // empty')" >/dev/null 2>&1 || true
    npm config set strict-ssl false >/dev/null 2>&1 || true
    npm config set maxsockets 1 >/dev/null 2>&1 || true
}
disable_npm() {
    command -v npm >/dev/null 2>&1 || return 0
    for k in proxy https-proxy strict-ssl maxsockets; do
        npm config delete "$k" >/dev/null 2>&1 || true
    done
}

enable_yarn() {
    command -v yarn >/dev/null 2>&1 || return 0
    yarn config set proxy "$(cfg_get '.httpProxy // empty')" >/dev/null 2>&1 || true
    yarn config set https-proxy "$(cfg_get '.httpsProxy // empty')" >/dev/null 2>&1 || true
}
disable_yarn() {
    command -v yarn >/dev/null 2>&1 || return 0
    yarn config delete proxy >/dev/null 2>&1 || yarn config unset proxy >/dev/null 2>&1 || true
    yarn config delete https-proxy >/dev/null 2>&1 || yarn config unset https-proxy >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------- pip

enable_pip() {
    command -v pip >/dev/null 2>&1 || command -v pip3 >/dev/null 2>&1 || return 0
    local url f="$PIP_CONF_DIR/pip.conf" tmp
    url=$(cfg_get '.httpProxy // empty')
    [[ -n $url ]] || return 0
    mkdir -p "$PIP_CONF_DIR"
    tmp="$f.tmp.$$"
    if [[ -f $f ]]; then
        awk -v p="proxy = $url" '
            /^[[:space:]]*proxy[[:space:]]*=/ { next }
            { print }
            /^\[global\][[:space:]]*$/ && !done { print p; done = 1 }
        ' "$f" > "$tmp"
        grep -q '^\[global\]' "$tmp" || printf '\n[global]\nproxy = %s\n' "$url" >> "$tmp"
    else
        printf '[global]\nproxy = %s\n' "$url" > "$tmp"
    fi
    mv -f "$tmp" "$f"
}
disable_pip() {
    local f="$PIP_CONF_DIR/pip.conf" tmp
    [[ -f $f ]] || return 0
    tmp="$f.tmp.$$"
    awk '/^[[:space:]]*proxy[[:space:]]*=/ { next } { print }' "$f" > "$tmp"
    if grep -qvE '^[[:space:]]*(\[global\])?[[:space:]]*$' "$tmp"; then
        mv -f "$tmp" "$f"
    else
        rm -f "$tmp" "$f"
    fi
}

# --------------------------------------------------------------------- curl

enable_curl() {
    local http no tmp
    http=$(cfg_get '.httpProxy // empty')
    no=$(cfg_get '.noProxy // empty')
    [[ -n $http ]] || return 0
    tmp="$CURLRC.tmp.$$"
    if [[ -f $CURLRC ]]; then
        sed '/^# PROXY_SETTINGS$/,/^# END_PROXY_SETTINGS$/d' "$CURLRC" > "$tmp"
    else
        : > "$tmp"
    fi
    {
        echo "# PROXY_SETTINGS"
        echo "proxy = \"$http\""
        [[ -n $no ]] && echo "noproxy = \"$no\""
        echo "# END_PROXY_SETTINGS"
    } >> "$tmp"
    mv -f "$tmp" "$CURLRC"
}
disable_curl() {
    [[ -f $CURLRC ]] || return 0
    local tmp="$CURLRC.tmp.$$"
    sed '/^# PROXY_SETTINGS$/,/^# END_PROXY_SETTINGS$/d' "$CURLRC" > "$tmp" || { rm -f "$tmp"; return 0; }
    if grep -q '[^[:space:]]' "$tmp"; then
        mv -f "$tmp" "$CURLRC"
    else
        rm -f "$tmp" "$CURLRC"
    fi
}

# --------------------------------------------------------------------- apt
# Replaces the Omarchy pacman integration. apt reads /etc/apt/apt.conf.d/,
# which needs root, so the write goes through pkexec and a polkit-authorized
# helper that only accepts a validated URL.

enable_apt() {
    local url; url=$(cfg_get '.httpProxy // empty')
    [[ -n $url ]] || return 0
    if [[ ! -x $APT_HELPER ]]; then
        warn "apt helper missing at $APT_HELPER (run install.sh)"
        return 0
    fi
    if command -v pkexec >/dev/null 2>&1 && timeout 60 pkexec "$APT_HELPER" set "$url" 2>/dev/null; then
        mkdir -p "$STATE_DIR"
        : > "$APT_MARKER"
    else
        warn "could not configure apt (authentication cancelled or pkexec unavailable)"
    fi
}
disable_apt() {
    [[ -f $APT_MARKER ]] || return 0
    if command -v pkexec >/dev/null 2>&1 && [[ -x $APT_HELPER ]]; then
        timeout 60 pkexec "$APT_HELPER" remove 2>/dev/null || warn "could not remove apt proxy config"
    fi
    rm -f "$APT_MARKER"
}

# ---------------------------------------------------------------- browsers
# Chromium-family browsers only: Firefox ignores --proxy-server. Browser
# launchers go through a wrapper that reads the live gateway at launch time.

write_wrapper() {
    [[ -f $WRAPPER_SRC ]] || { warn "wrapper source not found: $WRAPPER_SRC"; return 1; }
    mkdir -p "$BIN_DIR"
    cp -f "$WRAPPER_SRC" "$BIN_DIR/proxy-browser"
    chmod +x "$BIN_DIR/proxy-browser"
}

ensure_wrapper_links() {
    local name
    for name in $BROWSERS; do
        [[ -f $SYS_APPS/$name.desktop ]] || continue
        ln -sfn "$BIN_DIR/proxy-browser" "$BIN_DIR/proxy-$name"
    done
}

route_launcher() {
    local file="$1" name="$2"
    sed -i "s|^Exec=[^ ]*|Exec=$BIN_DIR/proxy-$name|" "$file"
}

enable_browser() {
    local url name sys user
    url=$(cfg_get '.httpProxy // empty')
    [[ -n $url ]] || return 0
    write_wrapper || return 0
    ensure_wrapper_links
    mkdir -p "$STATE_DIR" "$USER_APPS"
    printf '%s\n' "$url" > "$GATEWAY_FILE"
    for name in $BROWSERS; do
        sys="$SYS_APPS/$name.desktop"
        user="$USER_APPS/$name.desktop"
        [[ -f $sys ]] || continue
        [[ -f $user.orig ]] || cp "$sys" "$user.orig"
        cp -f "$user.orig" "$user"
        route_launcher "$user" "$name"
    done
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$USER_APPS" >/dev/null 2>&1
    return 0
}

disable_browser() {
    local name
    rm -f "$GATEWAY_FILE"
    for name in $BROWSERS; do
        [[ -f $USER_APPS/$name.desktop.orig ]] || continue
        rm -f "$USER_APPS/$name.desktop" "$USER_APPS/$name.desktop.orig" "$BIN_DIR/proxy-$name"
    done
    rm -f "$BIN_DIR/proxy-browser"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$USER_APPS" >/dev/null 2>&1
    return 0
}

# ------------------------------------------------------------------- vscode

# VS Code settings.json is usually JSONC (it allows comments), which jq rejects.
# So instead of parsing it, only the two proxy lines are edited as text; every
# other line, including comments, is left exactly as it was.
_vscode_remove_proxy_lines() {
    sed -E '/^[[:space:]]*"http\.proxy(StrictSSL)?"[[:space:]]*:/d' "$1"
}

enable_vscode() {
    local url tmp
    url=$(cfg_get '.httpProxy // empty')
    [[ -f $VSCODE_SETTINGS && -n $url ]] || return 0
    tmp="$VSCODE_SETTINGS.tmp.$$"
    _vscode_remove_proxy_lines "$VSCODE_SETTINGS" | awk -v u="$url" '
        { print }
        !done && /^[[:space:]]*\{[[:space:]]*$/ {
            print "    \"http.proxy\": \"" u "\","
            print "    \"http.proxyStrictSSL\": false,"
            done = 1
        }
        END { if (!done) exit 3 }
    ' > "$tmp"
    if [[ $? -eq 0 ]]; then
        cp -f "$VSCODE_SETTINGS" "$VSCODE_SETTINGS.proxy-manager.bak"
        mv -f "$tmp" "$VSCODE_SETTINGS"
    else
        rm -f "$tmp"
        warn "could not find the opening { line in $VSCODE_SETTINGS; add http.proxy manually"
    fi
}

disable_vscode() {
    [[ -f $VSCODE_SETTINGS ]] || return 0
    local tmp="$VSCODE_SETTINGS.tmp.$$"
    _vscode_remove_proxy_lines "$VSCODE_SETTINGS" > "$tmp" && mv -f "$tmp" "$VSCODE_SETTINGS"
}

# ------------------------------------------------------------------- apply

# ----------------------------------------------------- extra integrations

url_host() { sed -E 's|^https?://([^:/]+).*|\1|' <<<"$1"; }
url_port() {
    local p
    p=$(sed -E 's|^https?://[^:/]+:?([0-9]*).*|\1|' <<<"$1")
    echo "${p:-8080}"
}

# wget reads ~/.wgetrc

enable_wget() {
    local url rc="$HOME/.wgetrc" tmp
    url=$(cfg_get '.httpProxy // empty')
    [[ -n $url ]] || return 0
    tmp="$rc.tmp.$$"
    if [[ -f $rc ]]; then
        sed '/^# PROXY_SETTINGS$/,/^# END_PROXY_SETTINGS$/d' "$rc" > "$tmp"
    else
        : > "$tmp"
    fi
    {
        echo "# PROXY_SETTINGS"
        echo "use_proxy = on"
        echo "http_proxy = $url"
        echo "https_proxy = $url"
        echo "# END_PROXY_SETTINGS"
    } >> "$tmp"
    mv -f "$tmp" "$rc"
}

disable_wget() {
    local rc="$HOME/.wgetrc" tmp
    [[ -f $rc ]] || return 0
    tmp="$rc.tmp.$$"
    sed '/^# PROXY_SETTINGS$/,/^# END_PROXY_SETTINGS$/d' "$rc" > "$tmp"
    if grep -q '[^[:space:]]' "$tmp"; then
        mv -f "$tmp" "$rc"
    else
        rm -f "$tmp" "$rc"
    fi
}

# Docker client: the proxy is passed to containers it starts or builds.

enable_docker() {
    local url no tmp
    url=$(cfg_get '.httpProxy // empty')
    no=$(cfg_get '.noProxy // empty')
    [[ -n $url ]] || return 0
    mkdir -p "$(dirname "$DOCKER_CONF")"
    [[ -f $DOCKER_CONF ]] || echo '{}' > "$DOCKER_CONF"
    tmp="$DOCKER_CONF.tmp.$$"
    if jq --arg h "$url" --arg n "$no" \
            '.proxies.default = {httpProxy: $h, httpsProxy: $h, noProxy: $n}' \
            "$DOCKER_CONF" > "$tmp" 2>/dev/null && [[ -s $tmp ]]; then
        mv -f "$tmp" "$DOCKER_CONF"
    else
        rm -f "$tmp"
        warn "could not update $DOCKER_CONF (is it valid JSON?)"
    fi
}

disable_docker() {
    local tmp ours
    [[ -f $DOCKER_CONF ]] || return 0
    ours=$(cfg_get '.httpProxy // empty')
    tmp="$DOCKER_CONF.tmp.$$"
    if jq --arg h "$ours" 'if (.proxies.default.httpProxy == $h) then del(.proxies.default) else . end' \
            "$DOCKER_CONF" > "$tmp" 2>/dev/null && [[ -s $tmp ]]; then
        mv -f "$tmp" "$DOCKER_CONF"
    else
        rm -f "$tmp"
        warn "could not update $DOCKER_CONF"
    fi
}

# Firefox: writes a marked block to user.js in each profile.

firefox_profiles() {
    local d
    for d in "$HOME"/.mozilla/firefox/*/ "$HOME"/snap/firefox/common/.mozilla/firefox/*/; do
        [[ -f "${d}prefs.js" ]] && printf '%s\n' "${d%/}"
    done
}

firefox_active() {
    local profile
    while IFS= read -r profile; do
        if grep -q '^// PROXY_SETTINGS$' "$profile/user.js" 2>/dev/null &&
           grep -q 'network.proxy.type", 1' "$profile/user.js" 2>/dev/null; then
            return 0
        fi
    done < <(firefox_profiles)
    return 1
}

enable_firefox() {
    local url host port profile file tmp
    url=$(cfg_get '.httpProxy // empty')
    [[ -n $url ]] || return 0
    host=$(url_host "$url")
    port=$(url_port "$url")
    while IFS= read -r profile; do
        file="$profile/user.js"
        tmp="$file.tmp.$$"
        {
            if [[ -f $file ]]; then
                sed '/^\/\/ PROXY_SETTINGS$/,/^\/\/ END_PROXY_SETTINGS$/d' "$file"
            fi
            cat <<PREFS
// PROXY_SETTINGS
user_pref("network.proxy.type", 1);
user_pref("network.proxy.http", "$host");
user_pref("network.proxy.http_port", $port);
user_pref("network.proxy.ssl", "$host");
user_pref("network.proxy.ssl_port", $port);
user_pref("network.proxy.share_proxy_settings", true);
user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");
// END_PROXY_SETTINGS
PREFS
        } > "$tmp" && mv -f "$tmp" "$file"
    done < <(firefox_profiles)
}

disable_firefox() {
    local profile file tmp
    while IFS= read -r profile; do
        file="$profile/user.js"
        grep -q '^// PROXY_SETTINGS$' "$file" 2>/dev/null || continue
        tmp="$file.tmp.$$"
        {
            sed '/^\/\/ PROXY_SETTINGS$/,/^\/\/ END_PROXY_SETTINGS$/d' "$file"
            cat <<'PREFS'
// PROXY_SETTINGS
user_pref("network.proxy.type", 0);
// END_PROXY_SETTINGS
PREFS
        } > "$tmp" && mv -f "$tmp" "$file"
    done < <(firefox_profiles)
}

# System-wide proxy (Mint network settings and most GTK/Cinnamon apps)

system_active() {
    command -v gsettings >/dev/null 2>&1 &&
        [[ "$(timeout 2 gsettings get org.gnome.system.proxy mode 2>/dev/null)" == "'manual'" ]]
}

enable_system() {
    local url host port no list="" h
    local hosts=()
    command -v gsettings >/dev/null 2>&1 || return 0
    url=$(cfg_get '.httpProxy // empty')
    [[ -n $url ]] || return 0
    host=$(url_host "$url")
    port=$(url_port "$url")
    no=$(cfg_get '.noProxy // empty')
    IFS=',' read -ra hosts <<<"$no"
    for h in "${hosts[@]}"; do
        h="${h//[[:space:]]/}"
        [[ -n $h ]] && list+="'$h', "
    done
    list="[${list%, }]"
    gsettings set org.gnome.system.proxy use-same-proxy true 2>/dev/null || true
    gsettings set org.gnome.system.proxy ignore-hosts "$list" 2>/dev/null || true
    gsettings set org.gnome.system.proxy.http host "$host" 2>/dev/null || true
    gsettings set org.gnome.system.proxy.http port "$port" 2>/dev/null || true
    gsettings set org.gnome.system.proxy.https host "$host" 2>/dev/null || true
    gsettings set org.gnome.system.proxy.https port "$port" 2>/dev/null || true
    gsettings set org.gnome.system.proxy mode 'manual' 2>/dev/null || true
}

disable_system() {
    command -v gsettings >/dev/null 2>&1 || return 0
    local ours current
    ours=$(url_host "$(cfg_get '.httpProxy // empty')")
    current=$(timeout 2 gsettings get org.gnome.system.proxy.http host 2>/dev/null | tr -d "'")
    # Turn it off only if it is manual and points at our gateway (or we know no gateway).
    if [[ "$(timeout 2 gsettings get org.gnome.system.proxy mode 2>/dev/null)" == "'manual'" ]] &&
       [[ -z $ours || $current == "$ours" ]]; then
        gsettings set org.gnome.system.proxy mode 'none' 2>/dev/null || true
    fi
}

apply() {
    local action="$1" name
    for name in $ALL_INTEGRATIONS; do           # apt last: it may prompt for auth
        if [[ $action == enable ]]; then
            if cfg_has_integration "$name"; then
                "enable_${name}"
                remember_applied "$name"
            fi
        elif cfg_has_integration "$name" || applied_has "$name"; then
            "disable_${name}"
        fi
    done
    if [[ $action == disable ]]; then
        mkdir -p "$STATE_DIR"
        if [[ -f $APT_MARKER ]]; then
            printf 'apt\n' > "$APPLIED_FILE"     # apt may need a password to undo; keep it recorded
        else
            rm -f "$APPLIED_FILE"
        fi
    fi
}

apply_current() {
    local name
    for name in env git npm yarn pip curl wget docker firefox system browser vscode; do
        if cfg_has_integration "$name"; then
            "enable_${name}"
            remember_applied "$name"
        fi
    done
}

# ------------------------------------------------------------------ status

integration_active() {
    local env=false bashrc=false git=false npm=false yarn=false pip=false
    local curl=false apt=false vscode=false browser=false v
    local wget=false docker=false firefox=false system=false

    [[ -f $ENV_DIR/proxy.conf ]] && env=true
    if grep -q '^# PROXY_SETTINGS$' "$BASHRC" 2>/dev/null && [[ -f $ENV_DIR/proxy.conf ]]; then
        bashrc=true
    fi
    git config --global --get http.proxy >/dev/null 2>&1 && git=true
    if command -v npm >/dev/null 2>&1; then
        v=$(timeout 3 npm config get proxy 2>/dev/null)
        [[ -n $v && $v != null ]] && npm=true
    fi
    if command -v yarn >/dev/null 2>&1; then
        v=$(timeout 3 yarn config get proxy 2>/dev/null)
        [[ -n $v && $v != null && $v != undefined ]] && yarn=true
    fi
    grep -qE '^[[:space:]]*proxy[[:space:]]*=' "$PIP_CONF_DIR/pip.conf" 2>/dev/null && pip=true
    grep -q '^proxy = ' "$CURLRC" 2>/dev/null && curl=true
    [[ -f $APT_MARKER ]] && apt=true
    grep -qE '^[[:space:]]*"http\.proxy"[[:space:]]*:' "$VSCODE_SETTINGS" 2>/dev/null && vscode=true
    [[ -f $GATEWAY_FILE ]] && browser=true
    [[ -f $HOME/.wgetrc ]] && grep -q '^# PROXY_SETTINGS$' "$HOME/.wgetrc" && wget=true
    [[ -f $DOCKER_CONF ]] && jq -e '.proxies.default != null' "$DOCKER_CONF" >/dev/null 2>&1 && docker=true
    firefox_active && firefox=true
    system_active && system=true

    jq -nc \
        --arg env "$env" --arg bashrc "$bashrc" --arg git "$git" --arg npm "$npm" \
        --arg yarn "$yarn" --arg pip "$pip" --arg curl "$curl" --arg apt "$apt" \
        --arg vscode "$vscode" --arg browser "$browser" --arg wget "$wget" \
        --arg docker "$docker" --arg firefox "$firefox" --arg system "$system" '{
            env: ($env == "true"), bashrc: ($bashrc == "true"), git: ($git == "true"),
            npm: ($npm == "true"), yarn: ($yarn == "true"), pip: ($pip == "true"),
            curl: ($curl == "true"), apt: ($apt == "true"), vscode: ($vscode == "true"),
            browser: ($browser == "true"), wget: ($wget == "true"), docker: ($docker == "true"),
            firefox: ($firefox == "true"), system: ($system == "true")
        }'
}

cmd_status() {
    if ! validate_config; then
        jq -nc '{error: "invalid proxy configuration"}'
        return 1
    fi
    local active
    active=$(integration_active)
    read_config | jq -c --argjson active "$active" '{
        enabled: (.enabled // false),
        httpProxy: (.httpProxy // ""),
        httpsProxy: (.httpsProxy // ""),
        noProxy: (.noProxy // ""),
        gatewayAuto: (if .gatewayAuto == false then false else true end),
        integrations: ((.integrations // []) | map(if . == "pacman" then "apt" else . end)),
        active: $active
    }'
}

# ----------------------------------------------------------- gateway watcher

start_watcher() {
    mkdir -p "$STATE_DIR"
    if [[ -f $WATCHER_PID_FILE ]]; then
        local old
        old=$(cat "$WATCHER_PID_FILE" 2>/dev/null)
        if [[ -n $old ]] && kill -0 "$old" 2>/dev/null; then
            return 0
        fi
        rm -f "$WATCHER_PID_FILE"
    fi

    cat > "$WATCHER_SCRIPT" <<'WATCHER'
#!/bin/bash
# Polls the default gateway every 5 seconds. When it changes while the proxy
# is enabled, re-applies the integrations through proxy-manager.sh.
CONFIG_FILE="$HOME/.config/proxy-manager/proxy.json"
PM="__PM__"
gw() {
    ip route show default 2>/dev/null |
        awk '$0 !~ /dev (tun|tap|wg)[0-9]*/ && $2 == "via" { print $3; exit }'
}
last_gw=$(gw)
while true; do
    sleep 5
    [[ "$(jq -r '.enabled // false' "$CONFIG_FILE" 2>/dev/null)" == "true" ]] || continue
    new_gw=$(gw)
    [[ -n $new_gw && $new_gw != "$last_gw" ]] || continue
    last_gw=$new_gw
    result=$(bash "$PM" gateway-change 2>/dev/null) || continue
    [[ "$(jq -r '.gatewayChanged // false' <<<"$result")" == "true" ]] || continue
    new_url=$(jq -r '.new // ""' <<<"$result")
    if [[ "$(jq -r '.proxyOff // false' <<<"$result")" == "true" ]]; then
        notify-send -a "Proxy Manager" -u critical -i network-offline "Proxy turned off" \
            "Gateway changed to $new_url, but no proxy answered there. Your internet is direct again." 2>/dev/null || true
        continue
    fi
    body="Proxy re-applied to $new_url"
    if [[ "$(jq -r '.aptStale // false' <<<"$result")" == "true" ]]; then
        body="$body. Toggle the proxy off and on to update apt."
    fi
    notify-send -a "Proxy Manager" -i network-proxy "Gateway changed" "$body" 2>/dev/null || true
done
WATCHER
    sed -i "s|__PM__|$SELF|" "$WATCHER_SCRIPT"
    chmod +x "$WATCHER_SCRIPT"
    nohup bash "$WATCHER_SCRIPT" >/dev/null 2>&1 &
    echo $! > "$WATCHER_PID_FILE"
    disown 2>/dev/null || true
}

stop_watcher() {
    if [[ -f $WATCHER_PID_FILE ]]; then
        local pid
        pid=$(cat "$WATCHER_PID_FILE" 2>/dev/null)
        [[ -n $pid ]] && kill "$pid" 2>/dev/null
        rm -f "$WATCHER_PID_FILE"
    fi
}

# -------------------------------------------------------- connectivity check

check_connectivity() {
    local pids=() url pid
    for url in http://connectivitycheck.gstatic.com/generate_204 http://www.google.com http://1.1.1.1; do
        curl -s --noproxy '*' --connect-timeout 3 --max-time 5 -o /dev/null "$url" 2>/dev/null &
        pids+=($!)
    done
    for pid in "${pids[@]}"; do
        if wait "$pid" 2>/dev/null; then
            kill "${pids[@]}" 2>/dev/null
            return 0
        fi
    done
    return 1
}

notify_no_internet() {
    notify-send -a "Proxy Manager" -u critical -i network-offline \
        "Proxy disabled: no internet detected" \
        "Open a new terminal. If you use a phone hotspot, turn off the phone's proxy app and make sure the hotspot allows direct traffic." \
        2>/dev/null || true
}

# ---------------------------------------------------------------- commands

cmd_enable() {
    validate_config || return 1
    ensure_curl_integration
    refresh_gateway_urls
    local url; url=$(cfg_get '.httpProxy // empty')
    if [[ $FORCE != true ]] && ! gateway_answers "$url"; then
        jq -nc --arg u "$url" '{error: ("No proxy answered at " + $u + ". Nothing was changed. Start the proxy on that gateway, or run: proxy-manager.sh enable --force")}'
        return 1
    fi
    apply enable
    set_enabled_flag true
    start_watcher
    cmd_status
}

cmd_disable() {
    local no_check="${1:-false}"
    stop_watcher
    apply disable
    set_enabled_flag false
    rm -f "$WATCHER_SCRIPT"
    cmd_status
    if [[ $no_check == false ]]; then
        ( check_connectivity || notify_no_internet ) >/dev/null 2>&1 &
        disown 2>/dev/null || true
    fi
}

cmd_gateway_change() {
    local new_gw old_gw needs=() needs_json aptStale=false
    if [[ "$(cfg_get '.enabled // false')" != "true" ]]; then
        jq -nc '{gatewayChanged: false, old: "", new: "", needsRestart: [], aptStale: false, enabled: false}'
        return 0
    fi
    # Manual gateway: the user set the address, so network changes must not overwrite it.
    if [[ "$(cfg_get '.gatewayAuto')" == "false" ]]; then
        jq -nc '{gatewayChanged: false, old: "", new: "", needsRestart: [], aptStale: false, enabled: true}'
        return 0
    fi
    new_gw=$(detect_gateway_proxy)
    old_gw=$(cfg_get '.httpProxy // empty')
    if [[ $new_gw == "$old_gw" ]]; then
        jq -nc --arg old "$old_gw" --arg new "$new_gw" \
            '{gatewayChanged: false, old: $old, new: $new, needsRestart: [], aptStale: false, enabled: true}'
        return 0
    fi

    if [[ $FORCE != true ]] && ! gateway_answers "$new_gw"; then
        turn_off_everything
        jq -nc --arg old "$old_gw" --arg new "$new_gw" '{
            gatewayChanged: true, old: $old, new: $new, needsRestart: [],
            aptStale: false, enabled: false, proxyOff: true
        }'
        return 0
    fi
    update_config '.httpProxy = $url | .httpsProxy = $url' --arg url "$new_gw" || return 1
    mkdir -p "$STATE_DIR"
    printf '%s\n' "$new_gw" > "$GATEWAY_FILE"
    ensure_curl_integration 2>/dev/null || true
    apply_current

    if grep -qE '^[[:space:]]*"http\.proxy"[[:space:]]*:' "$VSCODE_SETTINGS" 2>/dev/null; then
        needs+=("VS Code")
    fi
    if command -v npm >/dev/null 2>&1 && [[ "$(npm config get proxy 2>/dev/null)" != "null" ]]; then
        needs+=("npm")
    fi
    [[ -f $APT_MARKER ]] && aptStale=true
    needs_json=$(jq -nc '$ARGS.positional' --args ${needs[@]+"${needs[@]}"})

    systemctl --user set-environment \
        http_proxy="$new_gw" HTTP_PROXY="$new_gw" \
        https_proxy="$new_gw" HTTPS_PROXY="$new_gw" 2>/dev/null || true

    jq -nc --arg old "$old_gw" --arg new "$new_gw" --argjson needs "$needs_json" \
        --argjson apt "$aptStale" '{
            gatewayChanged: true, old: $old, new: $new,
            needsRestart: $needs, aptStale: $apt, enabled: true
        }'
}

# ------------------------------------------------- settings (used by the menu)

is_enabled() { [[ "$(cfg_get '.enabled // false')" == "true" ]]; }

# set-gateway HOST PORT: manual gateway, turns auto-detect off.
cmd_set_gateway() {
    local host="${1:-}" port="${2:-}" url
    host="${host#http://}"; host="${host#https://}"; host="${host%/}"
    if ! [[ $host =~ ^[A-Za-z0-9._-]+$ ]]; then
        echo '{"error":"invalid gateway address"}'
        return 1
    fi
    if ! [[ $port =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
        echo '{"error":"port must be between 1 and 65535"}'
        return 1
    fi
    validate_config || return 1
    url="http://$host:$port"
    update_config '.gatewayAuto = false | .httpProxy = $u | .httpsProxy = $u | .port = ($p | tonumber)' \
        --arg u "$url" --arg p "$port" || return 1
    is_enabled && apply enable
    cmd_status
}

# set-auto true|false
cmd_set_auto() {
    local val="${1:-}"
    validate_config || return 1
    case "$val" in
        true)  update_config '.gatewayAuto = true' || return 1; refresh_gateway_urls ;;
        false) update_config '.gatewayAuto = false' || return 1 ;;
        *) echo '{"error":"expected true or false"}'; return 1 ;;
    esac
    is_enabled && apply enable
    cmd_status
}

# set-integration NAME on|off
cmd_set_integration() {
    local name="${1:-}" state="${2:-}"
    case " $ALL_INTEGRATIONS " in
        *" $name "*) ;;
        *) echo '{"error":"unknown integration"}'; return 1 ;;
    esac
    validate_config || return 1
    if [[ $state == on ]]; then
        update_config '.integrations = (((.integrations // []) | map(select(. != $n and . != "pacman"))) + [$n])' \
            --arg n "$name" || return 1
        is_enabled && "enable_$name"
    elif [[ $state == off ]]; then
        is_enabled && "disable_$name"
        forget_applied "$name"
        update_config '.integrations = ((.integrations // []) | map(select(. != $n and . != "pacman")))' \
            --arg n "$name" || return 1
    else
        echo '{"error":"expected on or off"}'
        return 1
    fi
    cmd_status
}

# test: check that the proxy actually forwards traffic; prints latency.
cmd_test() {
    local url out code ms
    url=$(cfg_get '.httpProxy // empty')
    if [[ -z $url ]]; then
        echo '{"error":"no gateway configured"}'
        return 1
    fi
    out=$(timeout 12 curl -s -o /dev/null -w '%{http_code} %{time_total}' \
        --proxy "$url" --max-time 8 http://connectivitycheck.gstatic.com/generate_204 2>/dev/null) || out="000 0"
    code=${out%% *}
    ms=$(awk -v t="${out#* }" 'BEGIN { printf "%d", t * 1000 }')
    if [[ $code == 204 ]]; then
        jq -nc --argjson ms "$ms" '{test: "ok", ms: $ms}'
    else
        jq -nc --arg c "$code" '{error: ("proxy did not answer (HTTP " + $c + ")")}'
        return 1
    fi
}

# detect: what auto-detect sees right now. Shown in the menu.
cmd_detect() {
    local gw iface port
    gw=$(default_gateway)
    iface=$(ip route show default 2>/dev/null |
        awk '$0 !~ /dev (tun|tap|wg)[0-9]*/ { for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }')
    port=$(get_port) || port=8080
    jq -nc --arg gw "$gw" --arg iface "$iface" --argjson port "$port" '{
        gateway: $gw, iface: $iface, port: $port,
        url: (if $gw == "" then "" else "http://" + $gw + ":" + ($port | tostring) end)
    }'
}

usage() {
    echo "usage: proxy-manager.sh <status|enable|disable [--no-check]|toggle|gateway-change|start-watcher|stop-watcher>" >&2
    exit 2
}

CMD="${1:-status}"
[[ $# -gt 0 ]] && shift
NO_CHECK=false
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --no-check) NO_CHECK=true ;;
        --force) FORCE=true ;;
        *) ARGS+=("$arg") ;;
    esac
done

case "$CMD" in
    status)         cmd_status ;;
    enable)         cmd_enable ;;
    disable)        cmd_disable "$NO_CHECK" ;;
    toggle)
        if [[ "$(cfg_get '.enabled // false')" == "true" ]]; then
            cmd_disable "$NO_CHECK"
        else
            cmd_enable
        fi
        ;;
    gateway-change) cmd_gateway_change ;;
    start-watcher)  start_watcher ;;
    stop-watcher)   stop_watcher ;;
    test)           cmd_test ;;
    detect)         cmd_detect ;;
    set-gateway)    cmd_set_gateway "${ARGS[0]:-}" "${ARGS[1]:-}" ;;
    set-auto)       cmd_set_auto "${ARGS[0]:-}" ;;
    set-integration) cmd_set_integration "${ARGS[0]:-}" "${ARGS[1]:-}" ;;
    *) usage ;;
esac
