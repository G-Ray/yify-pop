exports.create = function(self, streamURL, hostname, params) {
  var getport = require('getport');
  var request = require('request');
  var AdmZip = require('adm-zip');
  var http = require('http');
  var fs = require('fs');
  var opensrt = require('opensrt_js');
  var iconv = require('iconv-lite');
  var charsetDetect = require('jschardet');
  var _ = require('underscore');

  var isWin = process.platform === 'win32';

  getport(8889, 8999, function (e, port) {
    if (e) {
      self.redirect('/');
    } else {
      var osSpecificCommand = isWin ? 'cmd' : 'peerflix';
      var osSpecificArgs = isWin ? ['/c', 'peerflix', decodeURIComponent(params.file),  '--port=' + port, decodeURIComponent(params.file), '--tmp=tmp/']
                                                  : [decodeURIComponent(params.file),  '--port=' + port , decodeURIComponent(params.file), '--tmp=tmp/'];

      var childStream = require('child')({
        command: osSpecificCommand,
        args: osSpecificArgs,
        cbStdout: function(data) {
          console.log(String(data));
        }
      });

      streamURL = "http://" + hostname + ":" + port;
      var subtitles = {};

      // if it's a movie
      if (!params.show || params.show !== '1') {
        request('http://yts.re/api/movie.json?id=' + params.id, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            var yifyResponse = JSON.parse(body);

            var data = {};
            data.title = yifyResponse.MovieTitleClean;
            data.seeds = yifyResponse.TorrentSeeds;
            data.peers = yifyResponse.TorrentPeers;
            data.cover = yifyResponse.MediumCover;

            // fetch subtitles
            request('http://api.yifysubtitles.com/subs/' + yifyResponse.ImdbCode, function (error, response, body) {
              if (!error && response.statusCode == 200) {
                var yifySubsResponse = JSON.parse(body);

                // download a subtitle
                function fetchSub (url, dest, lang, callBack) {
                  var file = fs.createWriteStream(dest);
                  var request = http.get(url, function(response) {
                    response.pipe(file);
                    file.on('finish', function() {
                      file.close(callBack(dest, lang));
                    });
                  });
                }

                // unzip
                function unzip (dest, lang) {
                  var zip = new AdmZip(dest);
                  var zipEntries = zip.getEntries();

                  zipEntries.forEach(function(zipEntry) {
                      var fileName = zipEntry.entryName.toString();
                      var i = fileName.lastIndexOf('.');
                      if (fileName.substr(i).toUpperCase() == '.SRT') { // unzip only the srt file
                        var dir = "public/subtitles/" + yifyResponse.MovieTitleClean + '/';
                        zip.extractEntryTo(fileName, dir , false, true);

                        var buffer = fs.readFileSync(dir + fileName);
                        var charset = charsetDetect.detect(buffer);

                        if(charset.encoding != "utf-8") {
                          if(fileName === lang + '.srt') {
                            fs.renameSync(dir + fileName, dir + lang + '-non-utf8.srt');
                            fileName = lang + '-non-utf8.srt';
                          }

                          var input = fs.createReadStream(dir + fileName)
                          if(lang === 'french')  {
                            charset.encoding = 'ISO-8859-15';
                          }

                          var output = fs.createWriteStream(dir + lang + '.srt');
                          input.pipe(iconv.decodeStream(charset.encoding))
                              .pipe(iconv.encodeStream('utf8'))
                              .pipe(output)

                          fs.unlinkSync(dir + fileName); //remove the non-utf8 file
                        }
                        else {
                          if(fileName != lang + '.srt') {
                            fs.renameSync(dir + fileName, dir + lang + '.srt'); // Rename to language.srt
                          }
                        }
                      }
                    fs.unlinkSync(dest); // Remove the zip
                  });
                }

                for (var subs in yifySubsResponse.subs) {
                  for (var lang in yifySubsResponse.subs[subs]) {
                    var subUrl = 'http://www.yifysubtitles.com' + _.max(yifySubsResponse.subs[subs][lang], function(s){return s.rating;}).url;

                    fetchSub(subUrl, 'public/subtitles/' + lang + '.zip', lang, unzip);
                    // Build the subtitle url
                    if(lang === 'french' || lang === 'english') {
                      subtitles[lang] = 'http://' + hostname + '/subtitles/';
                      subtitles[lang] += encodeURIComponent(yifyResponse.MovieTitleClean) + '/' + lang + '.srt';
                    }
                  }
                }

                var pidToKill = 0;

                childStream.start(function(pid){
                  pidToKill = pid;

                  geddy.config.streamingProcesses.push({
                    pid: pid,
                    child: childStream,
                    torrent: decodeURIComponent(params.file),
                    stream: streamURL,
                    data: data,
                    subtitles: subtitles
                  });
                });

                var io = require('socket.io').listen(geddy.server);

                var spectators = 0;
                io.on('connection', function(socket){
                  spectators++;

                  socket.on('disconnect', function(){
                    spectators--;

                    if(spectators == 0) {
                      // Kill the streaming process
                      var rimraf = require('rimraf').sync;
                      for (var i=0; i < geddy.config.streamingProcesses.length; i++) {
                        if (geddy.config.streamingProcesses[i].pid == pidToKill) {
                          // Remove subtitles folder
                          rimraf('public/subtitles/' + geddy.config.streamingProcesses[i].data.title);
                          geddy.config.streamingProcesses[i].child.stop();
                          geddy.config.streamingProcesses.splice(i, 1);
                          console.log('Child is now stopped.');
                        }
                      }
                    }
                  });
                });

                self.respond({
                  params: params,
                  streamURL: streamURL,
                  subtitles: subtitles
                }, {
                  format: 'html',
                  template: 'app/views/main/stream'
                });
              }
            });
          }
        });
      }
      // else if it's a tv show
      else {
        request('http://eztvapi.re/show/' + params.id, function (error, response, body) {
          if (!error) {
            var show = JSON.parse(body);

            var data = {};
            data.title = show.title + ' S' + params.season + 'E' + params.episode;
            data.seeds = '0';
            data.peers = '0';
            data.cover = show.images.poster;

            // Split arguments and take the filename
            var fileName = params.file.split("&");
            for (var i=0; i<fileName.length; i++) {
               tmp = fileName[i].split("=");
               if ( [tmp[0]] == "dn" ) { fileName = tmp[1]; }
             }

            // Prepare query to fetch tv show subtitles
            var query = {
              imdbid: params.id,
              season: params.season,
              episode: params.episode,
              filename: fileName
            }

            // Fetch subtitles
            opensrt.searchEpisode(query, function(err, res){
              if(err) return console.error("Error: " + err);

              for (var lang in res) {
                if(lang === 'fr') {
                  subtitles['french'] = res[lang].url;
                }
                if(lang === 'en') {
                  subtitles['english'] = res[lang].url;
                }
              }

              childStream.start(function(pid){
                geddy.config.streamingProcesses.push({
                  pid: pid,
                  child: childStream,
                  torrent: decodeURIComponent(params.file),
                  stream: streamURL,
                  data: data,
                  subtitles: subtitles
                });
              });

              self.respond({
                params: params,
                streamURL: streamURL,
                subtitles: subtitles
              }, {
                format: 'html',
                template: 'app/views/main/stream'
              });
            })
          }
        });
      }
    }
  });
};
