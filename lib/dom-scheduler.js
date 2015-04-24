(function(exports, name) {
  'use strict';

  var debug = false;
  function log(str) {
    if (!debug) {
      return;
    }

    console.log('🎶 ', str);
  }

  // The naive mode just executes all blocks right away
  // (useful for performance comparison).
  var naive = false;
  var naiveExec = function(block, live) {
    block();
    return Promise.resolve();
  };

  var liveProtectionWindow = 16 * 20; // 20 frames

  var scheduler = {
    // *Live* blocks should be used for direct manipulation use cases
    // (touchevents, scrollevents...).
    // They're exectuted in a requestAnimationFrame block and are protected
    // from mutations. Request might be cancelled by subsequent live blocks if
    // the event loop gets too busy.
    _liveTimeout: null,
    _liveProtection: false,
    _rafID: null, // TODO: have one rafID by event type?
    live: function(block) {
      if (naive) {
        block();
        return;
      }

      if (this._liveTimeout) {
        clearTimeout(this._liveTimeout);
        this._liveTimeout = null;
      }

      this._liveProtection = true;

      this._liveTimeout = setTimeout((function() {
        this._liveProtection = false
        this._flushMutations();
        this._dequeueTransitions();
      }).bind(this), liveProtectionWindow);

      if (this._rafID) {
        window.cancelAnimationFrame(this._rafID);
        this._rafID = null;
      }

      this._rafID = window.requestAnimationFrame(function() {
        var startDate;
        if (debug) {
          startDate = performance.now();
        }

        block();

        if (debug) {
          var blockDuration = performance.now() - startDate;
          if (blockDuration > 16) {
            log('Live block took more than a frame (' +
                 blockDuration.toString() + 'ms)');
          }
        }
      });
    },

    // *Transitions* blocks have a built in 'transitionend' wait mechanism.
    // They're protected from mutation and will be delayed during a mutation
    // flush.
    // They will also be delayed by `live` blocks except when the `feedback`
    // flag is true, in that case they have the same priority as `live` blocks.
    //
    // -> Returns a promise fullfilled at the end of the transition for chaining
    _ongoingTransitions: 0,
    _queuedTransitions: [],
    transition: function(block, elm, evt, timeout, feedback) {
      if (naive) {
        return naiveExec(block);
      }

      timeout = timeout || 350;
      this._ongoingTransitions++;

      return new Promise((function(resolve, reject) {
        var content = (function() {
          block();

          if (!elm || !evt) {
            resolve();
            return;
          }

          var finishTimeout;

          var done = (function() {
            clearTimeout(finishTimeout);
            elm.removeEventListener(evt, done);

            this._ongoingTransitions--;
            if (this._ongoingTransitions == 0) {
              setTimeout(this._flushMutations.bind(this));
            }

            resolve();
          }).bind(this);

          elm.addEventListener(evt, done);
          finishTimeout = setTimeout(done, timeout);
        }).bind(this);

        if (this._flushing || (this._liveProtection && !feedback)) {
          this._queuedTransitions.push(content);
        } else {
          content();
        }
      }).bind(this));
    },

    _dequeueTransitions: function() {
      var content;
      while (content = this._queuedTransitions.shift()) {
        content();
      }
    },

    // *Mutations* blocks should be used to write to the DOM or perform
    // non-live actions requiring a reflow.
    // We shoud always aim for the document to be almost visually identical
    // _before_ and _after_ a mutation block.
    // Any big change in layout/size will cause a flash/jump.
    //
    // -> Returns a promise fullfilled after the reflow for chaining
    _pendingMutations: [],
    mutation: function(block) {
      if (naive) {
        return naiveExec(block);
      }

      return new Promise((function(resolve, reject) {
        if (this._liveProtection || this._ongoingTransitions > 0) {
          this._pendingMutations.push({
            block: block,
            resolve: resolve
          });
        } else {
          block();
          resolve();
        }
      }).bind(this));
    },

    _flushing: false,
    _flushMutations: function() {
      if (this._pendingMutations.length === 0) {
        return;
      }

      if (this._liveProtection || this._ongoingTransitions > 0) {
        return;
      }

      this._flushing = true;

      var fulfilments =
        this._pendingMutations
          .map(function(obj) { return obj.resolve })
          .reverse();

      var obj;
      while (obj = this._pendingMutations.shift()) {
        obj.block();
      }

      fulfilments.forEach(function(resolve) { resolve(); });
      setTimeout((function() {
        this._flushing = false;
        this._dequeueTransitions();
      }).bind(this));
    }
  };

  exports[name] = scheduler;
})(window, 'maestro');