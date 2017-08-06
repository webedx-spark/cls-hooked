/* eslint-disable max-len */
'use strict';

const util = require('util');
const assert = require('assert');
const wrapEmitter = require('emitter-listener');
const async_hooks = require('async_hooks');

const CONTEXTS_SYMBOL = 'cls@contexts';
const ERROR_SYMBOL = 'error@context';

const DEBUG_CLS_HOOKED = process.env.DEBUG_CLS_HOOKED;

let currentExecAsyncId = -1;

module.exports = {
  getNamespace: getNamespace,
  createNamespace: createNamespace,
  destroyNamespace: destroyNamespace,
  reset: reset,
  ERROR_SYMBOL: ERROR_SYMBOL
};

/**
 *
 * @param {string} name - Unique name of namespace
 * @constructor
 */
function Namespace(name) {
  /**
   * name - Unique name of namespace
   * @type {string}
   */
  this.name = name;
  // changed in 2.7: no default context
  this.active = null;
  /**
   * _set is used to manage entering and existing namespace context via Run, Bind, etc
   * @type {Array}
   * @private
   */
  this._set = [];
  this.id = null;
  /**
   * Used to manage context per AsyncId via async_hooks
   * @type {Map}
   * @private
   */
  this._contexts = new Map();
  this._indent = 0;
}

Namespace.prototype.set = function set(key, value) {
  if (!this.active) {
    throw new Error('No context available. ns.run() or ns.bind() must be called first.');
  }

  this.active[key] = value;

  if (DEBUG_CLS_HOOKED) {
    debugHooked('CONTEXT-SET KEY:', this, null, null, null, null, false, `_set len:${this._set.length} ${key}=${this.active[key]} `);
  }

  return value;
};

Namespace.prototype.get = function get(key) {
  if (!this.active) {
    if (DEBUG_CLS_HOOKED) {
      debugHooked('CONTEXT-GETTING KEY NO ACTIVE NS:', this, null, null, null, null, false, `_set len:${this._set.length}`);
    }
    return undefined;
  }
  if (DEBUG_CLS_HOOKED) {
    debugHooked('CONTEXT-GETTING KEY:', this, null, null, null, null, false, `_set len:${this._set.length} ${key}=${this.active[key]} `);
  }
  return this.active[key];
};

Namespace.prototype.createContext = function createContext() {
  // Prototype inherit existing context if created a new child context within existing context.
  let context = Object.create(this.active ? this.active : Object.prototype);
  context._ns_name = this.name;
  context.id = currentExecAsyncId;

  if (DEBUG_CLS_HOOKED) {
    debugHooked('CONTEXT-CREATED Context:', this, null, null, null, null, false, `_set len:${this._set.length} context:${util.inspect(context)}`);
  }

  return context;
};

Namespace.prototype.run = function run(fn) {
  let context = this.createContext();
  this.enter(context);

  try {
    if (DEBUG_CLS_HOOKED) {
      debugHooked('CONTEXT-RUN BEGIN:', this, null, null, null, null, false, `_set len:${this._set.length} context:${util.inspect(context)}`);
    }
    fn(context);
    return context;
  } catch (exception) {
    if (exception) {
      exception[ERROR_SYMBOL] = context;
    }
    throw exception;
  } finally {
    if (DEBUG_CLS_HOOKED) {
      debugHooked('CONTEXT-RUN END:', this, null, null, null, null, false, `_set len:${this._set.length} ${util.inspect(context)}`);
    }
    this.exit(context);
  }
};

Namespace.prototype.runAndReturn = function runAndReturn(fn) {
  let value;
  this.run(function (context) {
    value = fn(context);
  });
  return value;
};

/**
 * Uses global Promise and assumes Promise is cls friendly or wrapped already.
 * @param {function} fn
 * @returns {*}
 */
Namespace.prototype.runPromise = function runPromise(fn) {
  let context = this.createContext();
  this.enter(context);

  if(typeof fn !== 'function') {
    throw new Error('fn must be a function.');
  }

  let promise = fn(context);
  if (!promise || !promise.then || !promise.catch) {
    throw new Error('fn must return a promise.');
  }

  if (DEBUG_CLS_HOOKED) {
    debug2('CONTEXT-runPromise BEFORE: (' + this.name + ') currentExecAsyncId:' + currentExecAsyncId + ' len:' + this._set.length + ' ' + util.inspect(context));
  }

  return promise
    .then(result => {
      if (DEBUG_CLS_HOOKED) {
        debug2('CONTEXT-runPromise AFTER then: (' + this.name + ') currentExecAsyncId:' + currentExecAsyncId + ' len:' + this._set.length + ' ' + util.inspect(context));
      }
      this.exit(context);
      return result;
    })
    .catch(err => {
      err[ERROR_SYMBOL] = context;
      if (DEBUG_CLS_HOOKED) {
        debug2('CONTEXT-runPromise AFTER catch: (' + this.name + ') currentExecAsyncId:' + currentExecAsyncId + ' len:' + this._set.length + ' ' + util.inspect(context));
      }
      this.exit(context);
      throw err;
    });
};

Namespace.prototype.bind = function bindFactory(fn, context) {
  if (!context) {
    if (!this.active) {
      context = this.createContext();
    } else {
      context = this.active;
    }
  }

  let self = this;
  return function clsBind() {
    self.enter(context);
    try {
      return fn.apply(this, arguments);
    } catch (exception) {
      if (exception) {
        exception[ERROR_SYMBOL] = context;
      }
      throw exception;
    } finally {
      self.exit(context);
    }
  };
};

Namespace.prototype.enter = function enter(context) {
  assert.ok(context, 'context must be provided for entering');
  this._set.push(this.active);
  this.active = context;

  if (DEBUG_CLS_HOOKED) {
    debugHooked('CONTEXT-ENTER:', this, null, null, null, null, false, `_set len:${this._set.length}`);
    //this._indent += 2;
  }

};

Namespace.prototype.exit = function exit(context) {
  assert.ok(context, 'context must be provided for exiting');

  // Fast path for most exits that are at the top of the stack
  if (this.active === context) {
    assert.ok(this._set.length, 'can\'t remove top context');
    this.active = this._set.pop();
    if (DEBUG_CLS_HOOKED) {
      debugHooked('CONTEXT-EXIT:', this, null, null, null, null, false, `_set len:${this._set.length}`);
    }
    return;
  }

  // Fast search in the stack using lastIndexOf
  let index = this._set.lastIndexOf(context);

  if (index < 0) {
    if (DEBUG_CLS_HOOKED) {
      debug2(`??ERROR?? context exiting but not entered - ignoring: ${util.inspect(context)}`);
    }
    assert.ok(index >= 0, 'context not currently entered; can\'t exit. \n' + util.inspect(this) + '\n' + util.inspect(context));
  } else {
    // Check non-zero
    assert.ok(index, 'can\'t remove top context');
    this._set.splice(index, 1);
  }

  if (DEBUG_CLS_HOOKED) {
    debugHooked('CONTEXT-EXIT:', this, null, null, null, null, false, `_set len:${this._set.length}`);
    //this._indent -= 2;
  }

};

Namespace.prototype.bindEmitter = function bindEmitter(emitter) {
  assert.ok(emitter.on && emitter.addListener && emitter.emit, 'can only bind real EEs');

  let namespace = this;
  let thisSymbol = 'context@' + this.name;

  // Capture the context active at the time the emitter is bound.
  function attach(listener) {
    if (!listener) {
      return;
    }
    if (!listener[CONTEXTS_SYMBOL]) {
      listener[CONTEXTS_SYMBOL] = Object.create(null);
    }

    listener[CONTEXTS_SYMBOL][thisSymbol] = {
      namespace: namespace,
      context: namespace.active
    };
  }

  // At emit time, bind the listener within the correct context.
  function bind(unwrapped) {
    if (!(unwrapped && unwrapped[CONTEXTS_SYMBOL])) {
      return unwrapped;
    }

    let wrapped = unwrapped;
    let unwrappedContexts = unwrapped[CONTEXTS_SYMBOL];
    Object.keys(unwrappedContexts).forEach(function (name) {
      let thunk = unwrappedContexts[name];
      wrapped = thunk.namespace.bind(wrapped, thunk.context);
    });
    return wrapped;
  }

  wrapEmitter(emitter, attach, bind);
};

/**
 * If an error comes out of a namespace, it will have a context attached to it.
 * This function knows how to find it.
 *
 * @param {Error} exception Possibly annotated error.
 */
Namespace.prototype.fromException = function fromException(exception) {
  return exception[ERROR_SYMBOL];
};

function getNamespace(name) {
  return process.namespaces[name];
}

function createNamespace(name) {
  assert.ok(name, 'namespace must be given a name.');

  if (DEBUG_CLS_HOOKED) {
    debug2(`NS-CREATING NAMESPACE (${name})`);
  }
  let namespace = new Namespace(name);
  namespace.id = currentExecAsyncId;

  const hook = async_hooks.createHook({
    init(asyncId, type, triggerId, resource) {
      currentExecAsyncId = async_hooks.executionAsyncId();
      const staticTriggerId = async_hooks.triggerAsyncId();

      const parentId = resource && resource.parentId;

      if (namespace.active) {
        namespace._contexts.set(asyncId, namespace.active);

        if (DEBUG_CLS_HOOKED) {
          debugHooked('INIT', namespace, type, asyncId, resource, parentId, false, `INIT-triggerId:${triggerId}`);
        }

      } else if (currentExecAsyncId === 0) {
        // CurrentId will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        const triggerIdContext = namespace._contexts.get(staticTriggerId);
        if (triggerIdContext) {
          namespace._contexts.set(asyncId, triggerIdContext);
          if (DEBUG_CLS_HOOKED) {
            // The triggerId passed into this init() func is often different than the staticTriggerId from async_hook.triggerAsyncId() for TCPWRAP's child executions.
            debugHooked('INIT USING CONTEXT FROM TRIGGERID', namespace, type, asyncId, resource, parentId, false, `INIT-triggerId:${triggerId}`);
          }
        } else if (DEBUG_CLS_HOOKED) {
          // No active Context set so ignore
        }

      } else if (DEBUG_CLS_HOOKED) {
        // No active Context set so ignore
        //debugHooked('INIT CASE THREE -NO', namespace, type, asyncId, resource, parentId, false );
      }

      /*if (DEBUG_CLS_HOOKED && type === 'PROMISE') {
        debugHooked('INIT RESOURCE-PROMISE', namespace, type, asyncId, resource, parentId, false );
      }*/

    },
    before(asyncId) {
      currentExecAsyncId = async_hooks.executionAsyncId();
      let context;

      if (currentExecAsyncId === 0) {
        // currentExecAsyncId will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        const triggerId = async_hooks.triggerAsyncId();
        context = namespace._contexts.get(asyncId) || namespace._contexts.get(triggerId);
      } else {
        context = namespace._contexts.get(currentExecAsyncId);
      }

      if (context) {

        if (DEBUG_CLS_HOOKED) {
          debugHooked('BEFORE', namespace, null, asyncId, null, null, false);
          namespace._indent += 2;
        }

        namespace.enter(context);

      } else if (DEBUG_CLS_HOOKED) {
        //debugHooked('BEFORE MISSING CONTEXT', namespace, null, asyncId, null, null, true);
      }
    },
    after(asyncId) {
      currentExecAsyncId = async_hooks.executionAsyncId();
      let context; // = namespace._contexts.get(currentExecAsyncId);

      if (currentExecAsyncId === 0) {
        // currentExecAsyncId will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        const triggerId = async_hooks.triggerAsyncId();
        context = namespace._contexts.get(asyncId) || namespace._contexts.get(triggerId);
      } else {
        context = namespace._contexts.get(currentExecAsyncId);
      }

      if (context) {
        if (DEBUG_CLS_HOOKED) {
          namespace._indent -= 2;
          debugHooked('AFTER', namespace, null, asyncId, null, null, false);
        }

        namespace.exit(context);

      } else if (DEBUG_CLS_HOOKED) {
        //namespace._indent -= 2;
        //debugHooked('AFTER MISSING CONTEXT', namespace, null, asyncId, null, null, true);
      }
    },
    destroy(asyncId) {
      currentExecAsyncId = async_hooks.executionAsyncId();
      if (DEBUG_CLS_HOOKED) {
        debugHooked('DESTROY', namespace, null, asyncId, null, null, false, `currentExecAsyncId: ${currentExecAsyncId}`);
      }

      namespace._contexts.delete(asyncId);
      namespace._contexts.delete(currentExecAsyncId);
    }
  });

  hook.enable();

  process.namespaces[name] = namespace;
  return namespace;
}

function destroyNamespace(name) {
  let namespace = getNamespace(name);

  assert.ok(namespace, 'can\'t delete nonexistent namespace! "' + name + '"');
  assert.ok(namespace.id, 'don\'t assign to process.namespaces directly! ' + util.inspect(namespace));

  process.namespaces[name] = null;
}

function reset() {
  //TODO: must unregister async listeners
  if (process.namespaces) {
    Object.keys(process.namespaces).forEach(function (name) {
      destroyNamespace(name);
    });
  }
  process.namespaces = Object.create(null);
}

process.namespaces = {};

let _debugId = 0
function debugHooked(msg, namespace, type, asyncId, resource = null, parentId, printAllContexts = false, ...args){
  if (DEBUG_CLS_HOOKED) {
    _debugId++;
    //const indentStr = ' '.repeat(namespace._indent < 0 ? 0 : namespace._indent);
    const indentStr = ' '.repeat(namespace._indent || 0);
    const currentExecAsyncId = async_hooks.executionAsyncId();
    const triggerId = async_hooks.triggerAsyncId();
    if(printAllContexts){
      debug2(`${_debugId} ${indentStr}${msg} [${type}] (${namespace.name}) asyncId:${asyncId} currentExecAsyncId:${currentExecAsyncId} triggerId:${triggerId} parentId:${parentId} active:${util.inspect(namespace.active, { showHidden: true, depth: 2, colors: true })} resource:${resource} namespace._contexts:${util.inspect(namespace._contexts, { showHidden: true, depth: 2, colors: true })}`, ...args);
    }else{
      debug2(`${_debugId} ${indentStr}${msg} [${type}] (${namespace.name}) asyncId:${asyncId} currentExecAsyncId:${currentExecAsyncId} triggerId:${triggerId} parentId:${parentId} active:${util.inspect(namespace.active, { showHidden: true, depth: 2, colors: true })} resource:${resource}`, ...args);
    }
  }
}

//const fs = require('fs');
function debug2(...args) {
  if (DEBUG_CLS_HOOKED) {
    //fs.writeSync(1, `${util.format(...args)}\n`);
    process._rawDebug(`${util.format(...args)}`);
  }
}


