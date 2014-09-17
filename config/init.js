var init = function(cb) {
  geddy.config.streamingProcesses = [];

  // Add uncaught-exception handler in prod-like environments
  if (geddy.config.environment != 'development') {
    process.addListener('uncaughtException', function (err) {
      var msg = err.message;
      if (err.stack) {
        msg += '\n' + err.stack;
      }
      if (!msg) {
        msg = JSON.stringify(err);
      }
      geddy.log.error(msg);
    });
  }
  cb();

  var cache_manager = require('cache-manager');
  geddy.config.memory_cache = cache_manager.caching({store: 'memory', max: 100, ttl: 43200/*12H*/});
};

exports.init = init;
