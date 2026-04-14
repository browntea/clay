// store.js - Zustand-like vanilla store for client state
// Single source of truth for all mutable UI state.
// Functions stay in their modules; only data lives here.

var _state = {};
var _listeners = [];

function createStore(initial) {
  _state = Object.assign({}, initial);
}

var store = {
  getState: function () { return _state; },
  setState: function (partial) {
    var prev = _state;
    _state = Object.assign({}, _state, partial);
    for (var i = 0; i < _listeners.length; i++) _listeners[i](_state, prev);
  },
  subscribe: function (listener) {
    _listeners.push(listener);
    return function () {
      _listeners = _listeners.filter(function (l) { return l !== listener; });
    };
  }
};

export { createStore, store };
