const acorn = require('acorn');
const Scope = require('./scope');

class Signal {
  constructor(type, value) {
    this.type = type;
    this.value = value;
  }
}

function* evaluate(node, scope) {
  if (!node) return;
  switch (node.type) {
    case 'Program': {
      // 先预解析，对var和function变量提升
      for (const expression of node.body) {
        if (expression.type === 'FunctionDeclaration') {
          const gen = evaluate.call(this, expression, scope);
          let result = gen.next();
          while (!result.done) {
            result = gen.next(yield result.value);
          }
        } else if (
          expression.type === 'VariableDeclaration' &&
          expression.kind === 'var'
        ) {
          expression.declarations.forEach((dec) => {
            scope.declare('var', dec.id.name);
          });
        }
      }

      for (const expression of node.body) {
        if (expression !== 'FunctionDeclaration') {
          const gen = evaluate.call(this, expression, scope);
          let result = gen.next();
          while (!result.done) {
            result = gen.next(yield result.value);
          }
        }
      }
      return;
    }
    // 字面量直接返回
    case 'Literal': {
      return node.value;
    }
    // 从scope中根据变量名返回对应值
    case 'Identifier': {
      return scope.get(node.name);
    }
    case 'BlockStatement': {
      // 预解析进行变量提升
      const blockScope = new Scope({}, scope, 'block');
      for (const expression of node.body) {
        if (expression.type === 'FunctionDeclaration') {
          const gen = evaluate.call(this, expression, scope);
          let result = gen.next();
          while (!result.done) {
            result = gen.next(yield result.value);
          }
        } else if (
          expression.type === 'VariableDeclaration' &&
          expression.kind === 'var'
        )
          expression.declarations?.forEach((d) => {
            blockScope.declare('var', d.id.name);
          });
      }
      // 普通作用域
      let result;
      for (const expression of node.body) {
        const gen = evaluate.call(this, expression, blockScope);
        let res = gen.next();
        while (!res.done) {
          res = gen.next(yield res.value);
        }
        result = res.value;
        if (result instanceof Signal) return result;
      }
      return result;
    }
    case 'FunctionDeclaration': {
      const generator = function* (...args) {
        const generatorScope = new Scope({}, scope, 'function');
        node.params.forEach((p, i) => {
          generatorScope.declare('let', p.name, args[i]);
        });

        let gen = evaluate(node.body, generatorScope);

        let rightValue = gen.next();
        while (!rightValue.done) {
          rightValue = gen.next(yield rightValue.value);
        }
        rightValue = rightValue.value;

        if (rightValue?.type === 'return') return rightValue.value;
        else return rightValue;
      };
      //generator函数
      if (node.generator) {
        return scope.declare('var', node.id.name, generator);
      }
      // async函数
      if (node.async) {
        const asyncFun = function (...args) {
          return new Promise((resolve, reject) => {
            const gen = generator();
            const asyncScope = new Scope({}, scope, 'function');
            node.params.forEach((param, i) => {
              asyncScope.declare('let', param.name, args[i]);
            });
            function next(data) {
              try {
                const { done, value } = gen.next(data);
                if (done) {
                  resolve(value);
                } else {
                  // 将后面的代码放入微任务队列
                  Promise.resolve().then((data) => next(data));
                }
              } catch (exception) {
                reject(exception);
              }
            }
            next();
          });
        };
        return scope.declare('var', node.id.name, asyncFun);
      }
      // 普通函数
      const func = function (...args) {
        const funcScope = new Scope({}, scope, 'function');
        node.params.forEach((param, i) => {
          funcScope.declare('let', param.name, args[i]);
        });

        const gen = evaluate.call(this, node.body, funcScope);
        let res = gen.next();
        let result = res.value;

        if (result instanceof Signal && result.type === 'return')
          return result.value;
        return;
      };
      Object.defineProperty(func, 'name', {
        get() {
          return node.id?.name;
        }
      });
      Object.defineProperty(func, 'length', {
        get() {
          return node.params.length;
        }
      });
      return scope.declare('var', node.id.name, func);
    }

    // 变量声明
    case 'VariableDeclaration': {
      for (const dec of node.declarations) {
        const gen = evaluate.call(this, dec.init, scope);

        let result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        result = result.value;

        scope.declare(node.kind, dec.id.name, result);
      }
      return;
    }
    // 表达式语句(除声明之外的语句)
    case 'ExpressionStatement': {
      const gen = evaluate.call(this, node.expression, scope);
      let result = gen.next();
      while (!result.done) {
        result = gen.next(yield result.value);
      }
      return result.value;
    }

    // if语句, 每个consequent包含当前if或者elseif，alternate递归包含后面的elseif/else语句
    case 'IfStatement': {
      const ifScope = new Scope({}, scope, 'block');
      if (evaluate.call(this, node.test, scope).next().value) {
        const gen = evaluate.call(this, node.consequent, ifScope);
        let result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        return result.value;
      } else if (node.alternate) {
        const gen = evaluate.call(this, node.alternate, ifScope);
        let result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        return (result = result.value);
      } else return;
    }
    // 赋值语句
    case 'AssignmentExpression': {
      if (node.left.type === 'Identifier') {
        // 当操作符为=，并且未使用var let const 声明时，scope没有存储该变量，因此先执行表达式右侧获得值后使用var定义变量；
        const genRight = evaluate.call(this, node.right, scope);
        let right = genRight.next();
        while (!right.done) {
          right = genRight.next(yield right.value);
        }
        const rightValue = right.value;

        if (node.operator === '=') scope.set(node.left.name, rightValue);

        const genLeft = evaluate.call(this, node.left, scope);
        let left = genLeft.next();
        while (!left.done) {
          left = genLeft.next(yield left.value);
        }
        const leftValue = left.value;

        switch (node.operator) {
          case '+=':
            scope.set(node.left.name, leftValue + rightValue);
            break;
          case '-=':
            scope.set(node.left.name, leftValue - rightValue);
            break;
          case '/=':
            scope.set(node.left.name, leftValue / rightValue);
            break;
          case '*=':
            scope.set(node.left.name, leftValue * rightValue);
            break;
          case '%=':
            scope.set(node.left.name, leftValue % rightValue);
            break;
        }
        return scope.get(node.left.name);
      } else if (node.left.type === 'MemberExpression') {
        const genLeft = evaluate.call(this, node.left, scope);
        let left = genLeft.next();
        while (!left.done) {
          left = genLeft.next(yield left.value);
        }

        let leftObj, leftPropName;
        leftPropName = node.left.property.name;

        let temp = node.left;
        if (temp?.object?.type === 'MemberExpression') {
          while (temp?.object?.type === 'MemberExpression') {
            temp = temp.object;
          }
          leftObj = scope.get(temp.object.name)[temp.property.name];
        } else if (temp.object.name === 'module') {
          leftObj = scope.get(temp.object.name);
        } else {
          leftObj = evaluate.call(this, temp.object, scope).next().value;
        }

        const genRight = evaluate.call(this, node.right, scope);
        let res = genRight.next();
        while (!res.done) res = genRight.next(yield res.value);
        let rightValue = res.value;

        if (node.operator === '=') return (leftObj[leftPropName] = rightValue);
        let leftValue = leftObj[leftPropName];
        let retVal;
        switch (node.operator) {
          case '+=':
            retVal = leftValue + rightValue;
            break;
          case '-=':
            retVal = leftValue - rightValue;
            break;
          case '/=':
            retVal = leftValue / rightValue;
            break;
          case '*=':
            retVal = leftValue * rightValue;
            break;
          case '%=':
            retVal = leftValue % rightValue;
            break;
          case '<<=':
            retVal = leftValue << rightValue;
            break;
          case '>>=':
            retVal = leftValue >> rightValue;
            break;
        }
        leftObj[leftPropName] = retVal;
        return retVal;
      }
    }

    // 数组表达式·
    case 'ArrayExpression': {
      const array = [];
      for (const element of node.elements) {
        const gen = evaluate.call(this, element, scope);
        let res = gen.next();
        while (!res.done) res = gen.next(yield res.value);
        array.push(res.value);
      }
      return array;
    }

    // Switch语句
    case 'SwitchStatement': {
      const switchScope = new Scope({}, scope, 'block');

      const gen = evaluate.call(this, node.discriminant, switchScope);
      let res = gen.next();
      while (!res.done) {
        res = gen.next(yield res.value);
      }
      let discriminant = res.value;

      let flag = false;
      let result;
      for (const case_ of node.cases) {
        if (flag === false) {
          if (case_.test !== null) {
            const gen = evaluate.call(this, case_.test, switchScope);
            result = gen.next();
            while (!result.done) {
              result = gen.next(yield result.value);
            }
            flag = result.value === discriminant;
          } else {
            // default
            flag = true;
          }
        }
        if (flag) {
          const caseScope = new Scope({}, switchScope, 'block');
          for (const c of case_.consequent) {
            //case如果不用{}包装起来会共享一个作用域
            const gen =
              c.type === 'BlockStatement'
                ? evaluate.call(this, c, caseScope)
                : evaluate.call(this, c, switchScope);
            let res = gen.next();
            while (!res.done) {
              res = gen.next(yield res.value);
            }
            result = res.value;
          }
          if (result instanceof Signal) return result;
        }
      }
      return result;
    }

    //while语句
    case 'WhileStatement': {
      const whileScope = new Scope({}, scope, 'block');
      while (evaluate.call(this, node.test, whileScope).next().value) {
        const gen = evaluate.call(this, node.body, whileScope);
        let result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        result = result.value;

        if (result instanceof Signal) {
          if (result.type === 'continue') {
            continue;
          }
          if (result.type === 'break') {
            break;
          }
          if (result.type === 'return') {
            return result;
          }
        }
      }
      return;
    }

    //for语句
    case 'ForStatement': {
      const forScope = new Scope({}, scope, 'block');
      for (
        node.init ? evaluate(node.init, forScope).next().value : null;
        node.test ? evaluate(node.test, forScope).next().value : true;
        node.update ? evaluate(node.update, forScope).next().value : null
      ) {
        const gen = evaluate.call(this, node.body, forScope);
        let result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        result = result.value;

        if (result instanceof Signal) {
          if (result.type === 'continue') {
            continue;
          }
          if (result.type === 'break') {
            break;
          }
          if (result.type === 'return') {
            return result;
          }
        }
      }
      return;
    }

    // doWhile语句
    case 'DoWhileStatement': {
      const doWhileScope = new Scope({}, scope, 'block');

      do {
        const gen = evaluate.call(this, node.body, doWhileScope);
        let result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        result = result.value;
        if (result instanceof Signal) {
          if (result.type === 'continue') {
            continue;
          }
          if (result.type === 'break') {
            break;
          }
          if (result.type === 'return') {
            return result;
          }
        }
      } while (evaluate(node.test, doWhileScope).next().value);

      return;
    }

    // 逻辑相同，可以合并
    case 'LogicalExpression':
    case 'BinaryExpression': {
      const gen = evaluate.call(this, node.left, scope);
      let result = gen.next();
      while (!result.done) {
        result = gen.next(yield result.value);
      }

      const left = result.value;

      const genRight = evaluate.call(this, node.right, scope);
      result = genRight.next();
      while (!result.done) {
        result = genRight.next(yield result.value);
      }
      const right = result.value;
      switch (node.operator) {
        case '&&':
          return left && right;
        case '||':
          return left || right;
        case '==':
          return left == right;
        case '!=':
          return left != right;
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
        case '<<':
          return left << right;
        case '>>':
          return left >> right;
        case '>>>':
          return left >>> right;
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return left % right;
        case '|':
          return left | right;
        case '^':
          return left ^ right;
        case '&':
          return left & right;
        case 'in':
          return left in right;
        case 'instanceof':
          return left instanceof right;
        case '**':
          return left ** right;
        default:
          return;
      }
    }

    // 一元表达式
    case 'UnaryExpression': {
      const gen = evaluate.call(this, node.argument, scope);
      let result;
      try {
        result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
      } catch (err) {
        if (node.operator === 'typeof') {
          return 'undefined';
        } else {
          throw err;
        }
      }

      const argument = result.value;
      let obj, propName;
      if (node.operator === 'delete') {
        let temp = node.argument;
        while (temp.object === 'MemberExpression') {
          temp = temp.object;
        }

        obj = evaluate.call(this, temp.object, scope).next().value;
        propName = temp.property.name;
      }
      switch (node.operator) {
        case '-':
          return -argument;
        case '+':
          return +argument;
        case '!':
          return !argument;
        case '~':
          return ~argument;
        case 'typeof':
          return typeof argument;
        case 'void':
          return void argument;
        case 'delete': {
          return delete obj[propName];
        }
      }
    }

    case 'UpdateExpression': {
      if (node.argument.type === 'MemberExpression') {
        let obj = evaluate.call(this, node.argument.object, scope).next().value;
        let objPropName = node.argument.property.name;

        if (node.operator === '++') {
          return node.prefix ? ++obj[objPropName] : obj[objPropName]++;
        } else {
          return node.prefix ? --obj[objPropName] : obj[objPropName]--;
        }
      } else if (node.argument.type === 'Identifier') {
        const gen = evaluate.call(this, node.argument, scope);
        let res = gen.next();
        while (!res.done) {
          res = gen.next(yield res.value);
        }
        let preValue = res.value;

        if (node.operator === '++') {
          scope.set(node.argument.name, preValue + 1);
          return node.prefix ? preValue + 1 : preValue;
        } else {
          scope.set(node.argument.name, preValue - 1);
          return node.prefix ? preValue - 1 : preValue;
        }
      }
    }

    // 三元表达式
    case 'ConditionalExpression': {
      const gen = evaluate.call(this, node.test, scope);
      let result = gen.next();
      while (!result.done) {
        result = gen.next(yield result.value);
      }
      const test = result.value;

      const genRight = test
        ? evaluate.call(this, node.consequent, scope)
        : evaluate.call(this, node.alternate, scope);

      result = genRight.next();
      while (!result.done) {
        result = genRight.next(yield result.value);
      }
      return result.value;
    }
    case 'MemberExpression': {
      let obj = evaluate.call(this, node.object, scope).next().value;
      let propertyName;

      if (node.computed) {
        propertyName = evaluate.call(this, node.property, scope).next().value;
      } else {
        propertyName = node.property.name;
      }
      let propValue = obj[propertyName];

      if (propValue instanceof Signal) propValue = propValue.value;
      return propValue;
    }
    case 'ObjectExpression': {
      const obj = {};
      for (const property of node.properties) {
        const val = evaluate.call(this, property.value, scope).next().value;

        let propName;
        if (property.computed) {
          propName = evaluate(property.key.name, scope).next().value;
        } else {
          propName = property.key.name;
        }

        if (property.kind === 'init') {
          if (property.value.type === 'FunctionExpression') {
            Object.defineProperty(val, 'name', {
              get() {
                return propName;
              }
            });
          }
          obj[property.key.name] = val;
        }
        if (property.kind === 'get') {
          Object.defineProperty(obj, propName, {
            get() {
              return val.call(obj);
            }
          });
          obj[property.key.name] = val;
        }
        if (property.kind === 'set') {
          Object.defineProperty(obj, propName, {
            set(value) {
              return val.call(obj, value);
            }
          });
        }
      }
      return obj;
    }

    case 'CallExpression': {
      const gen = evaluate.call(this, node.callee, scope);
      let result = gen.next();
      while (!result.done) {
        result = gen.next(yield result.value);
      }
      let callee = result.value;

      const args = [];
      for (const arg of node.arguments) {
        const gen = evaluate.call(this, arg, scope);
        let result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        args.push(result.value);
      }

      if (node.callee.type === 'MemberExpression') {
        let temp = node;
        while (temp.type === 'CallExpression') {
          temp = temp.callee;
        }

        let obj = evaluate(temp.object, scope).next().value;
        let propName = temp.property.name;

        let func = obj[propName];

        result = func.apply(obj, args);
      } else {
        result = callee.apply(this, args);
      }
      if (result instanceof Signal) {
        return result.value;
      } else {
        return result;
      }
    }

    /* 
      函数表达式和函数声明的区别；
      1.函数声明必须有标识符，函数表达式可以省略，表达式的名字不能在外部使用
      2.函数声明会被预解析，表达式不会
    */
    case 'FunctionExpression': {
      let func;
      const generator = function* (...args) {
        const generatorScope = new Scope({}, scope, 'function');
        node.params.forEach((p, i) => {
          generatorScope.declare('let', p.name, args[i]);
        });

        let gen = evaluate(node.body, generatorScope);

        let rightValue = gen.next();
        while (!rightValue.done) {
          rightValue = gen.next(yield rightValue.value);
        }
        rightValue = rightValue.value;

        if (rightValue?.type === 'return') return rightValue.value;
        else return rightValue;
      };
      //generator函数
      if (node.generator) {
        func = generator;
      }
      // async函数
      if (node.async) {
        const asyncFun = function (...args) {
          return new Promise((resolve, reject) => {
            const gen = generator();
            const funcScope = new Scope({}, scope, 'function');
            node.params.forEach((param, i) => {
              funcScope.declare('let', param.name, args[i]);
            });
            function next(data) {
              try {
                const { done, value } = gen.next(data);
                if (done) {
                  resolve(value);
                } else if (value instanceof Promise) {
                  //当yield返回的是一个promise时，放到then里执行，使得yield后面的逻辑要等前面的执行完才行，达到同步效果
                  value.then((data) => next(data));
                } else {
                  // 将后面的代码放入微任务队列
                  Promise.resolve().then((data) => next(data));
                }
              } catch (exception) {
                reject(exception);
              }
            }

            next();
          });
        };
        func = asyncFun;
      }
      // 普通函数
      func = function (...args) {
        const funcScope = new Scope({}, scope, 'function');
        node.params.forEach((param, i) => {
          funcScope.declare('let', param.name, args[i]);
        });

        const gen = evaluate.call(this, node.body, funcScope);
        let res = gen.next();
        let result = res.value;

        if (result instanceof Signal && result.type === 'return')
          return result.value;
        return;
      };
      Object.defineProperty(func, 'name', {
        get() {
          return node.id?.name;
        }
      });
      Object.defineProperty(func, 'length', {
        get() {
          return node.params.length;
        }
      });
      return func;
    }
    // 箭头函数
    case 'ArrowFunctionExpression': {
      const generator = function* (...args) {
        const generatorScope = new Scope({}, scope, 'function');
        node.params.forEach((p, i) => {
          generatorScope.declare('let', p.name, args[i]);
        });

        let gen = evaluate(node.body, generatorScope);

        let rightValue = gen.next();
        while (!rightValue.done) {
          rightValue = gen.next(yield rightValue.value);
        }
        rightValue = rightValue.value;

        if (rightValue?.type === 'return') return rightValue.value;
        else return rightValue;
      };
      if (!node.async) {
        return (...args) => {
          const funScope = new Scope({}, scope, 'function');
          node.params.forEach((param, i) => {
            funScope.declare('let', param.name, args[i]);
          });
          const gen = evaluate.call(this, node.body, funScope);
          let result = gen.next().value;
          if (result instanceof Signal && result.type === 'return')
            return result.value;
          return result;
        };
      } else {
        // async箭头函数
        return (...args) => {
          return new Promise((resolve, reject) => {
            const gen = generator();
            const asyncScope = new Scope({}, scope, 'function');
            node.params.forEach((param, i) => {
              asyncScope.declare('let', param.name, args[i]);
            });
            function next(data) {
              try {
                const { done, value } = gen.next(data);
                if (done) {
                  resolve(value);
                } else {
                  // 将后面的代码放入微任务队列
                  Promise.resolve().then((data) => next(data));
                }
              } catch (exception) {
                reject(exception);
              }
            }
            next();
          });
        };
      }
    }
    // 逻辑相同可以合并
    case 'AwaitExpression':
    case 'YieldExpression': {
      const result = evaluate.call(this, node.argument, scope).next().value;
      return yield result;
    }
    // try 语句
    case 'TryStatement': {
      let result;
      try {
        const tryScope = new Scope({}, scope, 'block');
        const gen = evaluate.call(this, node.block, tryScope);
        let res = gen.next();
        while (!res.done) {
          res = gen.next(yield res.value);
        }
        result = res.value;
      } catch (err) {
        const catchScope = new Scope({}, scope, 'block');
        catchScope.declare('let', node.handler.param.name, err);
        const gen = evaluate.call(this, node.handler.body, catchScope);
        let res = gen.next();
        while (!res.done) {
          res = gen.next(yield res.value);
        }
        result = res.value;
      } finally {
        if (node.finalizer !== null) {
          const gen = evaluate.call(
            this,
            node.finalizer,
            new Scope({}, scope, 'block')
          );

          let res = gen.next();
          while (!res.done) {
            res = gen.next(yield res.value);
          }
          result = res.value;
        }
      }
      return result;
    }
    // continue 语句
    case 'ContinueStatement': {
      let continue_ = new Signal('continue');
      return continue_;
    }

    // break语句
    case 'BreakStatement': {
      let break_ = new Signal('break');
      return break_;
    }
    //return语句
    case 'ReturnStatement': {
      const gen = evaluate.call(this, node.argument, scope);
      let result = gen.next();
      while (!result.done) {
        result = gen.next(yield result.value);
      }
      return new Signal('return', result.value);
    }
    // throw语句
    case 'ThrowStatement': {
      const gen = evaluate.call(this, node.argument, scope);
      let result = gen.next();
      while (!result.done) {
        result = gen.next(yield result.value);
      }
      throw res.value;
    }

    case 'SequenceExpression': {
      let result;
      for (const expression of node.expressions) {
        const gen = evaluate.call(this, expression, scope);
        result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
      }
      return result.value;
    }
    case 'NewExpression': {
      let newScope = new Scope({}, scope, 'function');
      let gen = evaluate(node.callee, newScope);
      let result = gen.next();
      while (!result.done) {
        result = gen.next(yield result.value);
      }
      let func = result.value;
      let args = [];
      for (let arg of node.arguments) {
        gen = evaluate(arg, scope);
        result = gen.next();
        while (!result.done) {
          result = gen.next(yield result.value);
        }
        let e = result.value;
        args.push(e);
      }
      return new (func.bind.apply(func, [null].concat(...args)))();
    }
    case 'ThisExpression': {
      return this !== globalThis ? this : undefined;
    }
  }
  throw new Error(
    `Unsupported Syntax ${node.type} at Location ${node.start}:${node.end}`
  );
}

function customEval(code, scope) {
  scope.declare('const', 'module', { export: {} });

  const node = acorn.parse(code, {
    ecmaVersion: 2017
  });
  const gen = evaluate(node, scope);
  gen.next();
  return scope.get('module').exports;
}

module.exports = {
  customEval,
  Scope
};
