const fs = require('fs');
let src = fs.readFileSync('applet_logic.js', 'utf8');
// Run only the setup part (everything before the scenarios) with a loop counter in the mock.
const cut = src.indexOf("console.log('== applet logic ==');");
let setup = src.slice(0, cut);
setup = setup.replace("const applet = sandbox.main", "console.log('creating applet');\nconst applet = sandbox.main");
setup += "\nconsole.log('constructed; queue length', queue.length);\nflush();\nconsole.log('flushed; runs:', runs);\n";
eval(setup);
