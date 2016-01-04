var VERSION = '0.0.1',
    fs = require('fs'),
    request = require('superagent'),
    rq = require('request'),
    path = require('path');

function merge (defaults, options) {
  defaults = defaults || {};
  if (options && typeof options === 'object') {
    var keys = Object.keys(options);
    for (var i = 0, len = keys.length; i < len; i++) {
      var k = keys[i];
      if (options[k] !== undefined) defaults[k] = options[k];
    }
  }
  return defaults;
}

var reifyCallback = function(cb) {
  return function(err, res) {
    if (err) {
      cb(err);
    } else if (res && res.error) {
      cb(res.error);
    } else {
      cb(null, res.body);
    }
  }
}

var reifyRedirectCallback = function(cb) {
  return function(err, res) {
    if (err) {
      cb(err);
    } else if (res && res.redirect && res.headers && res.headers.location) {
      cb(null, res.headers.location)
    } else if (res && res.error) {
      cb(res.error);
    }
  }
}

function Box (options) {
  var defaults = {
    base_url: 'https://api.box.com/2.0',
    upload_url: 'https://upload.box.com/api/2.0',
    refresh_url: 'https://app.box.com/api',
    access_token: null,
    refresh_token: null,
    client_id: null,
    client_secret: null
  };

  this.options = merge(defaults, options);

  if (!this.options.access_token) {
    throw new Error('You need to provide an access token');
  } else {
    this.options.auth = 'Bearer '+ this.options.access_token;
  }

  this.folders = new Folders(this.options);
  this.files = new Files(this.options);
  this.sharedItems = new SharedItems(this.options);
  this.events = new Events(this.options);
  this.search = new Search(this.options);
}

Box.prototype.refreshAccessToken = function (callback) {
  var self = this;
  if (!this.options.client_id || !this.options.client_secret) {
    throw new Error('You need to provide a client id and client secret ');
  }
  else {
    request
    .post(this.options.refresh_url + '/oauth2/token')
    .field('grant_type', "refresh_token")
    .field('client_id', this.options.client_id)
    .field('client_secret', this.options.client_secret)
    .field('refresh_token', this.options.refresh_token)
//    .on('error', function(err) { callback(err, null) })
    .end(function (err, res) {
      if (err) {
        callback(err);
      } else {
        self.updateAccessToken(res.body.access_token);
        callback(null, res.body.access_token, res.body.refresh_token);
      }
    });
  }
};

Box.prototype.updateAccessToken = function (accessToken) {
  this.options.access_token = accessToken;
  this.options.auth = 'Bearer '+ this.options.access_token;
};

Box.VERSION = VERSION;
module.exports = Box;

// Search Resource
function Search (options) {
  this.options = options;
  this.resource = 'search';
}

// Generates a new search query for finding items (folders or files)
Search.prototype.new = function (query, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = null;
  }
  var uri = this.options.base_url+'/'+this.resource + '?query=' + encodeURIComponent(query);

  if (params) {
    var keys = Object.keys(params);
    for (var i = 0, len = keys.length; i < len; i++) {
      var key = keys[i];

      uri += '&'+key+'='+encodeURIComponent(params[key]);
    }
  }

  request
    .get(uri)
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};


// Files Resource
function Files (options) {
  this.options = options;
  this.resource = 'files';
}

// Utility method used to overload a method based on the number of arguments it has
// http://ejohn.org/blog/javascript-method-overloading/
function addMethod (object, name, fn) {
  var old = object[ name ];
  object[ name ] = function(){
    if ( fn.length == arguments.length ) {
      return fn.apply( this, arguments );
    } else if ( typeof old == 'function' ) {
      return old.apply( this, arguments );
    }
  };
}

// Uploads a file to a given folder... no custom filename
addMethod(Files.prototype, 'upload', function (filepath, folder, callback) {
  request
    .post(this.options.upload_url+'/'+this.resource+'/content')
    .set('Authorization', this.options.auth)
    .field('parent_id', folder)
    .attach('filename', filepath)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
});

// Uploads a file to a given folder a with custom filename
addMethod(Files.prototype, 'upload', function (filepath, filename, folder, callback) {
  request
    .post(this.options.upload_url+'/'+this.resource+'/content')
    .set('Authorization', this.options.auth)
    .field('attributes', JSON.stringify({
      parent: {
        id: folder
      },
      name: filename
    }))
    .attach('file', filepath)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
});

// Retrieves a download link for the given file
addMethod(Files.prototype, 'download', function (file, callback) {
  request
    .get(this.options.base_url+'/'+this.resource+ '/' +file+ '/content')
    .set('Authorization', this.options.auth)
    .redirects(0)
    .end(reifyRedirectCallback(callback));
});

// Retrieves a download link for the given file from a shared item
addMethod(Files.prototype, 'download', function (file, shareLink, callback) {
  var req = request.get(this.options.base_url+'/'+this.resource+ '/' +file+ '/content');

  req.set('Authorization', this.options.auth);
  req.set('BoxApi', 'shared_link='+shareLink);
  req.redirects(0);
  req.end(reifyRedirectCallback(callback));
});

Files.prototype.info = function (file, fields, callback) {
  if (typeof fields === 'function') {
    callback = fields;
    fields = null;
  }
  var uri = this.options.base_url+'/'+this.resource+'/'+file;

  if (fields) {
    uri += '?fields=' + fields;
  }

  request
    .get(uri)
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

// Creates metadata for a given file
Files.prototype.createMetadata = function (file, metadata, callback) {
  request
    .post(this.options.base_url+'/'+this.resource+'/'+file+'/metadata/properties')
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .send(metadata)
    .end(reifyCallback(callback));
};

// Retrieves metadata for a given file
Files.prototype.getAllMetadata = function(file, callback){
  request
    .get(this.options.base_url+'/'+this.resource+'/'+file+'/metadata/')
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

// Retrieves specific metadata (defined by <path>) for a given file
Files.prototype.getMetadata = function(file, path, callback){
  request
    .get(this.options.base_url+'/'+this.resource+'/'+file+'/metadata/'+path)
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

Files.prototype.createSharedLink = function(file, sharedLinkSettings, callback) {
  if (typeof sharedLinkSettings === 'function') {
    callback = sharedLinkSettings;
    sharedLinkSettings = {"shared_link": {}};
  }

  request
    .put(this.options.base_url+'/'+this.resource+'/'+file)
    .set('Authorization', this.options.auth)
    .send(sharedLinkSettings)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

// Folders Resource
function Folders (options) {
  this.options = options;
  this.resource = 'folders';
}

Folders.prototype.createSharedLink = function(folder, sharedLinkSettings, callback) {
  if (typeof sharedLinkSettings === 'function') {
    callback = sharedLinkSettings;
    sharedLinkSettings = {"shared_link": {}};
  }

  request
    .put(this.options.base_url+'/'+this.resource+'/'+folder)
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .send(sharedLinkSettings)
    .end(reifyCallback(callback));
};

// Retrieves info and lists contents of the root folder
Folders.prototype.root = function (callback) {
  request
    .get(this.options.base_url+'/'+this.resource+'/0')
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

// Retrieves info and lists contents of the given folder
Folders.prototype.info = function (folder, callback) {
  request
    .get(this.options.base_url+'/'+this.resource+'/'+folder)
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

addMethod(Folders.prototype, 'items', function (folder, limit, offset, fields, callback) {
  if (typeof fields === 'function') {
    callback = fields;
    fields = null;
  }
  var uri = this.options.base_url+'/'+this.resource+'/'+folder+'/items';

  if (fields) {
    uri += '?fields=' + fields +'&offset=' + offset + '&limit='+ limit;
  } else {
    uri += '?offset=' + offset + '&limit='+ limit;
  }

  var req = request.get(uri);
  req.set('Authorization', this.options.auth);
//  req.on('error', function(err) { callback(err, null) })
  req.end(reifyCallback(callback));
});

// Get items in shared folder
addMethod(Folders.prototype, 'items', function (folder, limit, offset, shareLink, fields, callback) {
  if (typeof fields === 'function') {
    callback = fields;
    fields = null;
  }
  var uri = this.options.base_url+'/'+this.resource+'/'+folder+'/items';

  if (fields) {
    uri += '?fields=' + fields +'&offset=' + offset + '&limit='+ limit;
  } else {
    uri += '?offset=' + offset + '&limit='+ limit;
  }

  var req = request.get(uri);
  req.set('Authorization', this.options.auth);
  req.set('BoxApi', 'shared_link='+shareLink);
//  req.on('error', function(err) { callback(err, null) })
  req.end(reifyCallback(callback));
});

// Creates a new folder given the parent
Folders.prototype.create = function (name, parent, callback) {
  request
    .post(this.options.base_url+'/'+this.resource)
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .send({
      name: name,
      parent : { id: parent }
    })
    .end(reifyCallback(callback));
};

// Deletes a folder. Recursive arguement must be included in order to delete folders that have items inside of them
Folders.prototype.delete = function (folder, recursive, callback) {
  if (typeof recursive === 'function') {
    callback = recursive;
    recursive = false;
  }

  var url = this.options.base_url+'/'+this.resource+'/'+folder+'?recursive='+recursive;

  request
    .del(url)
    .set('Authorization', this.options.auth)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

// Shared Items Resource
function SharedItems (options) {
  this.options = options;
  this.resource = 'shared_items';
}

SharedItems.prototype.info = function (shareLink, callback) {
  request
    .get(this.options.base_url+'/'+this.resource)
    .set('Authorization', this.options.auth)
    .set('BoxApi', 'shared_link='+shareLink)
//    .on('error', function(err) { callback(err, null) })
    .end(reifyCallback(callback));
};

// Events Resource
function Events (options) {
  this.options = options;
  this.resource = 'events';
}

Events.prototype.get = function (stream_position, callback) {
  request
  .get(this.options.base_url+'/'+this.resource+'/?stream_position=' + stream_position)
  .set('Authorization', this.options.auth)
//  .on('error', function(err) { callback(err, null) })
  .end(reifyCallback(callback));
};

Events.prototype.longPollOptions = function (callback) {
  var uri = this.options.base_url+'/'+this.resource;
  rq(uri, {
    method: 'options',
    headers: {
      'Authorization': this.options.auth
    }
  }, function (err, res, body) {
    var resultObj
    try {
      resultObj = JSON.parse(body);
    } catch(e) {
      return callback(e, null)
    }
    callback(err, resultObj);
  });
}

Events.prototype.longPoll = function(url, stream_position, callback) {
  var position_url = url+'&stream_position='+stream_position;

  request
  .get(position_url)
  .set('Authorization', this.options.auth)
//  .on('error', function(err) { callback(err, null) })
  .end(reifyCallback(callback));
}
