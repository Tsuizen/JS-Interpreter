const { customEval, Scope } = require('./src/eval');

const scope = new Scope();

const func = customEval(
  `
  async function foo() {
    console.log("start");
    await console.log('middle');
    console.log("end");
  }
  
  module.exports = foo;
`,
  scope
);

func();
console.log('out');
