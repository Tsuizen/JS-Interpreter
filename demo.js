const { customEval, Scope } = require('./src/eval');

const scope = new Scope();

const func = customEval(
  `
  async function foo() {
    console.log("start");
    console.log("second");
    await console.log('middle');
    console.log("end");
  }
  
  module.exports = foo;
`,
  scope
);

func();
console.log('out');
