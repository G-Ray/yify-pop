exports.getParams = function (imdbId) {

  var API_KEY = '7243033bcdd3fb18a273f9b901e4a17b';

  // Set request URL
  var tmdb = 'https://api.themoviedb.org/3/movie/' + imdbId + '?api_key=' + API_KEY;

  return tmdb;
};
