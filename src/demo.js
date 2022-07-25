const { customEval, Scope } = require('./eval');

const scope = new Scope();

const func = customEval(
  `
  function test(name){
    return "hello " + name;
  }
  
  module.exports = test;
`,
  scope
);

console.log(func('Tom'));
