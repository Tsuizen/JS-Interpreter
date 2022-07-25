// 定义scope存储值类型
class Value {
  constructor(value, kind) {
    this.value = value;
    this.kind = kind;
  }

  get() {
    return this.value;
  }

  set(value) {
    if (this.kind === "const") {
      throw new TypeError("Assignment to constant variable");
    } else {
      this.value = value;
    }
  }
}

class Scope {
  constructor(variables = {}, parent, type = "block") {
    this.variables = {};
    for (const key in variables) {
      this.variables[key] = new Value(variables[key]);
    }

    this.type = type;
    this.parent = parent;
  }

  declare(kind, name, initValue) {
    if (kind === "var" && name === "global") return new Value(initValue);
    if (kind === "var") {
      return this.var_(name, initValue);
    } else if (kind === "let") {
      return this.let_(name, initValue);
    } else if (kind === "const") {
      return this.const_(name, initValue);
    } else {
      throw new Error(`Invalid Variable Declaration Kind of ${kind}`);
    }
  }

  var_(name, value) {
    let scope = this;
    while (scope.parent && scope.type !== "function") {
      scope = scope.parent;
    }
    scope.variables[name] = new Value(value, "var");
    return scope.variables[name].value;
  }

  let_ (name, value) {
    if (this.variables[name]) {
      throw new SyntaxError(`Identifier ${name} has already been declared`);
    }
    this.variables[name] = new Value(value, "let");
    return this.variables[name].value;
  }

  const_(name, value) {
    if (this.variables[name]) {
      throw new SyntaxError(`Identifier ${name} has already been declared`);
    }
    this.variables[name] = new Value(value, "const");
    return this.variables[name].value;
  }

  get(name) {
    if (this.variables[name]) {
      return this.variables[name].value;
    } else if (this.parent) {
      return this.parent.get(name);
    } else if (name in globalThis) {
      return globalThis[name];
    } else {
      throw new Error(`${name} is not defined`);
    }
  }

  set(name, value) {
    if (name === "global") return;
    if (this.variables[name]) {
      this.variables[name].set(value);
    } else if (this.parent) {
      this.parent.set(name, value);
    } else if (name in globalThis) {
      return globalThis[name];
    } else {
      this.declare("var", name, value);
    }
  }
}

module.exports = Scope;
