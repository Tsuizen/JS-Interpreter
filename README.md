## 使用JS实现的ES5解释器
1. ES5的大部分语法（除for in, with, label语句）
2. 额外实现的功能
   - generotor函数
   - async函数
   - **

### Install
```
clone git@github.com:Tsuizen/JS-Interpreter.git
```
```
yarn install
```
### Usage
```javascript
const { customEval, Scope } = require('./src/eval');

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


```
### 参考资料
https://github.com/bramblex/jsjs-answer
