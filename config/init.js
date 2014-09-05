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

  var io = require('socket.io').listen(geddy.server);

  var users = 0;
  io.on('connection', function(socket){
    users++;

    socket.on('disconnect', function(){
      users--;

      //Kill all processes
      if(users == 0) {
        var rimraf = require('rimraf').sync;
        console.log(geddy.config.streamingProcesses.length);
        for (var i=geddy.config.streamingProcesses.length-1; i >= 0; i--) {
          // Remove subtitles folder
          rimraf('public/subtitles/' + geddy.config.streamingProcesses[i].data.title);
          geddy.config.streamingProcesses[i].child.stop();
          geddy.config.streamingProcesses.splice(i, 1);
        }
      }
    });
  });
};

exports.init = init;
