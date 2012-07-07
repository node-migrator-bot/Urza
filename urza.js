#!/usr/bin/env node
// Urza
// ----
// Urza is a framework for rapid node.js development.
// If you'd like to know more about urza, check out the README.md file in this same folder.
// ©2011 Jesse Ditson

if(require.main === module) {
  // Urza was called as a command line script.
  
  // Dependencies
  // ------------
  var fs = require('fs'),
      path = require('path'),
      wrench = require('wrench'),
      walk = require('./lib/helpers/walk'),
      mkdirp = require('mkdirp'),
      async = require('async'),
      exec = require('child_process').exec,
      program = require('commander');

  // **Main Urza file. This does all sorts of handy tasks.**

  // Some setup stuff to get ready.
  var version = JSON.parse(fs.readFileSync(__dirname + '/package.json')).version;

  // Command-Line App
  // ----------------
  
  // CLI Global Helpers
  var appRoot,
      getAppRoot = function(dir){
        if(appRoot) return appRoot;
        // looks up the directory tree until it finds a folder with a .urza file.
        var dir = dir ? dir.replace(/\/[^\/]+$/,'') : process.cwd();
        if(!dir.length){
          console.error('Urza app not found. Please run from inside an Urza app.');
          process.exit(1);
          return false;
        } else if(!fs.existsSync(dir + '/.urza')){
          return getAppRoot(dir);
        } else {
          appRoot = dir;
          return dir;
        }
      },
      parseJSON = function(string){
        var res = false;
        try {
          res=JSON.parse(string);
        } catch(e){
          //console.warn('failed first try to parse JSON: %s',e.message);
          try {
            string = string.replace(/'/g,'"');
            res=JSON.parse(string);
          } catch(e){
            console.error('FAILED PARSING: %s',string);
            throw e;
          }
        }
        return res;
      }

  // Set up our program:
  program
    .version(version);

  // Urza's Tasks
  // ------------

  // **Init**
  // creates an Urza app.

  program
    .command('init [appdir]')
    .description('create a new Urza app')
    .action(function(appdir){
      if(!appdir){
        console.error('Error: You must tell me where to put your app! Try init <appname>');
        process.exit(1);
      }
      var options = JSON.parse(fs.readFileSync(__dirname + '/example/package.json'));
      console.log('creating app %s...',appdir);
      // set up our app basics:
      var prompts = [
          ['prompt','What is your name?: ',function(author){ options.author = author; }],
          ['prompt','What is your email address?: ',function(email){ options.author += " <"+email+">"; }],
          ['prompt','Give your creation a name: ',function(name){ options.name = name.replace(' ','-'); }],
          ['prompt','Describe your creation: ',function(desc){ options.description = desc; }]
        ],
        // loops through commands until they are finished.
        doCommands = function(callback,i){
          i=i||0;
          var p = prompts[i],
              command=program[p.shift()],
              done=p.pop();
          p.push(function(){
            done.apply(program,arguments);
            i = i+1;
            if(i<prompts.length){
              doCommands(callback,i);
            } else {
              callback();
            }
          });
          command.apply(program,p);
        }
      doCommands(function(){
        // TODO: be more graceful with these errors.
        if(!options.name){
          console.error('Missing one or more required fields. Please fill in all the info asked.');
          process.exit(1);
        } else {
          // after all commands have finished, do this stuff:
          mkdirp(appdir,function(err){
            if(err){
              throw err;
              process.exit(1)
            } else {
              wrench.copyDirSyncRecursive(__dirname + '/example',appdir);
              console.log('created directory tree.');
              // we have created the app folder. now create the package.json file and replace appName in the files.
              console.log('adding names to app files.');
              walk(appdir,function(file,folder){
                var fPath = folder + '/'+ file,
                    content = fs.readFileSync(fPath,'utf8').replace(/\[\[APPNAME\]\]/g,options.name);
                fs.writeFileSync(fPath,content);
              },function(){
                // rename the database to match this app.
                // TODO: make this edit the config/default.json file.
                //if(!options.db) options.db = {};
                //options.db.name = appdir + "_db";
                // TODO: autodetect git repo.
                fs.writeFile(appdir + '/package.json',JSON.stringify(options,null,4));
                console.log('installing dependencies...');
                exec('cd '+appdir+' && npm install',function(){
                  process.exit(0);
                });
              });
            }
          });
        }
      });
    });
  
  // **Create Commands**
  // these create Urza app items.
  
  // Helpers
  var appViewFolder = '/client/js/lib/views/',
      appHtmlFolders = ['/client/views/mobile/','/client/views/web/'],
      appViewFile = '/client/js/lib/views.js',
      requireViewPath = 'lib/views/';
      updateViews = function(viewRoutes,raw){
        var root = getAppRoot(),
            appFile = root + appViewFile,
            viewFolder = root + appViewFolder,
            htmlFolders = appHtmlFolders.map(function(folder){ return root + folder; });
        if(fs.existsSync(appFile)){
          var clientContents = fs.readFileSync(appFile,'utf8'),
              viewFiles = fs.readdirSync(viewFolder),
              viewObjectPattern = /viewObject\s*=\s*(\{[^\{\}]*\})/,
              viewObjectMatches = clientContents.match(viewObjectPattern),
              viewArrayPattern = /define\((\[[^\]]*\])?/,
              viewArrayMatches = clientContents.match(viewArrayPattern);
          if(!viewObjectMatches || !viewObjectMatches[1] || !parseJSON(viewObjectMatches[1])){
            console.error('Error updating views. app.js does not appear to define a valid viewObject.');
            process.exit(1);
          }
          var viewObject = parseJSON(viewObjectMatches[1]),
              viewArray = parseJSON((viewArrayMatches && viewArrayMatches[1]) || '[]');
              viewHtmlTemplate = fs.readFileSync(__dirname + '/templates/view.html','utf8'),
              viewTemplate = fs.readFileSync(__dirname + '/templates/view.js','utf8');
          // loop through the views in viewRoutes
          for(var viewName in viewRoutes){
            if(!~viewFiles.indexOf(viewName + '.js')){
              // we don't have this view yet, add it.
              viewObject[requireViewPath + viewName] = '';
              viewArray.push(requireViewPath + viewName);
              if(viewRoutes[viewName]){
                // we have a route for this view.
                viewObject[requireViewPath+viewName] = viewRoutes[viewName].replace(/^\//,'');
              }
              // create the view.
              console.log('adding %s file',viewName+'.js');
              fs.writeFileSync(viewFolder + viewName + '.js', viewTemplate.replace(/\[\[NAME\]\]/g,viewName),'utf8');
              if(!raw){
                try {
                  // create the corresponding html files.
                  htmlFolders.forEach(function(folder){
                    // TODO: should the extension be read from the app settings?
                    console.log('adding %s file to %s',viewName+'.html',folder);
                    fs.writeFileSync(folder + viewName + '.html',viewHtmlTemplate.replace(/\[\[NAME\]\]/g,viewName),'utf8');
                  });
                } catch(e) {
                  console.error('Error creating view files. '+e.message);
                  // TODO: cleanup after error
                  process.exit(1);
                }
              }
            } else {
              // this view already exists.
              console.error('This view already exists - if you really want to replace it, please remove it first.');
              process.exit(1);
            }
          }
          var newClient = clientContents
                            .replace(viewObjectPattern,'viewObject = ' + JSON.stringify(viewObject,2))
                            .replace(viewArrayPattern,'define(' + JSON.stringify(viewArray,2));
          console.log('updating view object in views.js');
          fs.writeFileSync(appFile,newClient,'utf8');
        } else {
          console.error('Error updating views. Did you delete the views.js file?');
          process.exit(1);
        }
      },
      createView = function(name,route,raw){
        var root = getAppRoot(),
            routes = {};
        routes[name] = route;
        updateViews(routes,raw);
      },
      removeView = function(name){
        var root = getAppRoot(),
            appFile = root + appViewFile,
            viewFolder = root + appViewFolder,
            htmlFiles = appHtmlFolders.map(function(folder){ return root + folder + name + '.html'; }),
            removeFiles = [viewFolder + name + '.js'].concat(htmlFiles);
        if(fs.existsSync(appFile)){
          var clientContents = fs.readFileSync(appFile,'utf8'),
              viewFiles = fs.readdirSync(viewFolder),
              viewObjectPattern = /viewObject\s*=\s*(\{[^\{\}]*\})/,
              viewObjectMatches = clientContents.match(viewObjectPattern),
              viewArrayPattern = /define\((\[[^\]]*\])?/,
              viewArrayMatches = clientContents.match(viewArrayPattern);
          if(!viewObjectMatches || !viewObjectMatches[1] || !parseJSON(viewObjectMatches[1])){
            console.error('Error updating views. app.js does not appear to define a valid viewObject.');
            process.exit(1);
          }
          var viewObject = parseJSON(viewObjectMatches[1]),
              viewArray = parseJSON((viewArrayMatches && viewArrayMatches[1]) || '[]');
          delete viewObject[requireViewPath + name];
          viewArray.splice(viewArray.indexOf(requireViewPath + name),1);
          var newClient = clientContents
                            .replace(viewObjectPattern,'viewObject = ' + JSON.stringify(viewObject,2))
                            .replace(viewArrayPattern,'define(' + JSON.stringify(viewArray,2));
          console.log('updating view object in views.js');
          fs.writeFileSync(appFile,newClient,'utf8');
          console.log('removing view files');
          removeFiles.forEach(function(file){
            if(fs.existsSync(file)){
              fs.unlinkSync(file);
            } else {
              console.warn('didn\'t find view file %s - assuming it was deleted and continuing.',file);
            }
          });
          process.exit(0);
        } else {
          console.error('Error updating views. Did you delete the views.js file?');
          process.exit(1);
        }
      },
      createPartial = function(name){
        var root = getAppRoot(),
            htmlFiles = appHtmlFolders.map(function(folder){ return root + folder + 'partials/' + name + '.html'; }),
            viewTemplate = fs.readFileSync(__dirname + '/templates/partial.html','utf8');
        console.log('creating partial');
        htmlFiles.forEach(function(file){
          // create the partial.
          console.log('adding partial %s ',file);
          fs.writeFileSync(file, viewTemplate.replace(/\[\[NAME\]\]/g,name),'utf8');
        });
      },
      removePartial = function(name){
        var root = getAppRoot(),
            htmlFiles = appHtmlFolders.map(function(folder){ return root + folder + 'partials/' + name + '.html'; });
        htmlFiles.forEach(function(file){
          console.log('removing partial %s',file);
          if(fs.existsSync(file)){
            fs.unlinkSync(file);
          } else {
            console.warn('didn\'t find partial file %s - assuming it was deleted and continuing.',file);
          }
        });
        process.exit(0);
      };
  // Command
  program
    .command('create type [name]')
    .description('creates a new view or partial in the current Urza app.\n use `create view <name>` or `create partial <name>`.')
    .option('-r, --route <route>','specify a route for this to match. (view only)')
    .option('-j, --raw','don\'t create html views for this item. (view only)')
    .action(function(type,info){
      var rawArgs = info.parent.rawArgs,
          name = rawArgs[rawArgs.length-1];
      if(type=='view'){
        // create view command
        var route = info.route,
            raw = info.raw;
        createView(name,route,raw);
      } else if(type=='partial'){
        // create partial command
        createPartial(name);
      } else {
        if(type){
          console.log("I don't know how to create %s.",type);
        } else {
          console.log('please specify what you would like to create.');
        }
      }
    });
  // **Remove Items**
  program
    .command('remove type [name]')
    .description('removes a view or partial in the current Urza app.\n use `remove view <name>` or `remove partial <name`.')
    .action(function(type,info){
      // TODO: move duplicated logic up to a helper, check for uncommited changes before removing.
      var rawArgs = info.parent.rawArgs,
          name = rawArgs[rawArgs.length-1];
      if(type=='view'){
        // remove view command
        program.confirm('Are you sure you want to delete the '+name+' view?',function(yes){
          if(yes){
            removeView(name);
          } else {
            console.log('exiting');
            process.exit(0);
          }
        });
      } else if(type=='partial'){
        //remove partial command
        program.confirm('Are you sure you want to delete the '+name+' partial?',function(yes){
          if(yes){
            removePartial(name);
          } else {
            console.log('exiting');
            process.exit(0);
          }
        });
      } else {
        if(type){
          console.log("I don't know how to remove %s.",type);
        } else {
          console.log('please specify what you would like to remove.');
        }
      }
    });
  // Start it up
  program.parse(process.argv);
} else {
  // Urza was require()'d.
  
  // Dependencies
  // ------------

  var express = require('express'),
      fs = require('fs'),
      cluster = require('cluster'),
      _ = require('underscore'),
      path = require('path'),
      gzippo = require('gzippo');

  // Module Dependencies
  // -------------------
  var logger = require('./lib/logging/logger.js'),
      reporter = require('./lib/logging/reporter.js'),
      reqLogger = require('./lib/logging/requestLogger.js'),
      expressHandlebars = require('./lib/helpers/express-handlebars.js'),
      useragent = require('./lib/helpers/middleware/useragent.js'),
      render = require('./lib/helpers/middleware/render.js'),
      Api = require('./lib/api.js');
  // Urza App Class
  // --------------
  var UrzaServer = module.exports.Server = function(options){
    this.options = options;
    this.publicDir = this.options.environment == "development" ? "client" : "public";
    this.api = new Api();
    this.app = this.createApp();
    this.cluster = cluster;
    this.logger = logger;
    this.reporter = reporter;
    this.workers = [];
    this.workerMethods = {};
    if(options.configure){
      options.configure(this.app,this);
    }
    this.addRoutes(this.app);
    // mimic the routing behavior of express.
    var expressMethods = ['get','post','all','use','configure'];
    expressMethods.forEach(function(method){
      this[method] = this.app[method].bind(this.app);
    }.bind(this));
  }

  // **Start Server**
  // starts up the app
  UrzaServer.prototype.start = function(){
    if (this.options.environment=="production") {
      var numCpus = require('os').cpus().length;
    	// in production, set up cluster
    	if (cluster.isMaster) {
    		if (this.options.maxCpus){
    			var numberOfWorkers = this.options.maxCpus;
    		} else {
    			if (numCpus>1) {
    				var numberOfWorkers = numCpus;
    			} else {
    				var numberOfWorkers = 2;
    			};
    		}
        var forkWorker = function(){
    			var worker = cluster.fork();
          this.workers.push(worker);
          // allow communication to this worker
          worker.on('message',function(worker,message){
            if(this.workerMethods[message.method]){
              this.workerMethods[message.method].call(this,message.data)
            } else {
              logger.silly('worker tried to call method ' + message.method + ', but it does not exist. Data: ',message.data)
            }
          }.bind(this,worker))
        }.bind(this)
    		for(var i=0; i< numberOfWorkers; i++) {
    			forkWorker()
    		}
    	 	cluster.on('death', function(worker) {
    			forkWorker()
  	  	});
    	} else {
    		this.app.listen(this.options.serverPort);
    		logger.debug("Urza server master started listening on port: " + this.options.serverPort)
    	};	
    } else {
    	// in development, just run as an express instance.
    	this.app.listen(this.options.serverPort);
    	logger.debug("Urza server started as single process listening on port: " + this.options.serverPort)	
    };
  }

  // **Create App**
  // creates and configures an express app.
  UrzaServer.prototype.createApp = function(){
    var app = express.createServer();
    // **Express app configuration**
    app.configure(function(){
      // basic express stuff
    	app.use(express.bodyParser());
    	app.use(express.cookieParser());
      // TODO: add persistent sessions.
      if(this.options.sessionHandler){
        app.use(express.session(this.options.sessionHandler));
      } else {
        app.use(express.session({ secret: "aging daddies" }));
      }
      // templates
      this.configureTemplates(app);
      // middleware
    	app.use(express.methodOverride());
      var oneYear = 31557600000;
      app.use(gzippo.staticGzip('./' + this.publicDir,{ maxAge: oneYear }));
      app.use(gzippo.staticGzip(__dirname + '/client',{ maxAge: oneYear }));
      app.use(gzippo.compress());
      // if authenticate is specified, use the path specified as the authenticate middleware.
      if(this.options.authenticate){
        app.use(require(process.cwd() + '/' + this.options.authenticate).bind(this));
      }
    	app.use(useragent);
    	app.use(render);
    	app.use(reqLogger.create(logger));
    }.bind(this));
    // set up development only configurations
    app.configure('development', function(){
    	// Be as loud as possible during development errors
     	app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
    });
    // set up production only configurations
    app.configure('production', function(){
    	// Be as quiet as possible during production errors
     	app.use(express.errorHandler()); 
    });
    // add dynamic helpers
    this.configureHelpers(app);
    // return the ready to .listen() app.
    return app;
  }

  // **Set up dynamic helpers**
  // makes some assumptions about helpers...
  UrzaServer.prototype.configureHelpers = function(app){
    // set up dynamic helpers - these will be available in the layout scope when pages are rendered.
    var cssCache,
        componentPath = process.cwd() + '/client/css/components';
    app.dynamicHelpers({
      user : function(req,res){
        return req.session && req.session.user;
      },
      componentcss : function(req,res){
        if(!cssCache) cssCache = (fs.existsSync(componentPath)) ? fs.readdirSync(componentPath) : [];
        return cssCache;
      }
    });
    return app;
  }

  // **Set up Templating Engine**
  // configures the templating engine we want to work with.
  // TODO: may need larger abstraction of view logic.
  UrzaServer.prototype.configureTemplates = function(app){
    switch(this.options.templates && this.options.templates.engine){
      case 'handlebars' :
        // set up view engine
        app.set('view engine','html');
      	app.set('views',process.cwd()+ '/client/views');
      	app.register('html',expressHandlebars);
        this.templatingEngine = expressHandlebars;
        break;
      default :
        throw new Error('Unknown templating engine specified: "'+this.options.templates.engine+'"');
        break;
    }
    return app;
  }
  
  // **Call Api Method**
  // directly call the api
  UrzaServer.prototype.callApi = function(params,session,body,callback){
    var params = params[0] ? params[0].split('/') : [];
    this.api.route(params,session,body,callback);
  }

  // **Set up Routes**
  // sets up Urza's default routes
  UrzaServer.prototype.addRoutes = function(app){
    // **API Route**
    app.all("/api/*",function(req,res,next){
      this.callApi(req.params,req.session,req.body,function(err,response){
        if(err){
          res.json(err.message,500);
        } else {
          res.json(response);
        }
      });
    }.bind(this));
    //**Partial Route**
    // renders a partial based on an api call
    app.all(/\/partial\/([^\/]+)\/?(.+)?/,function(req,res,next){
      // Note: this is all hacked together because express does not appear to support optional splats.
      // http://stackoverflow.com/questions/10020099/express-js-routing-optional-spat-param
      var params = req.params[1] ? [req.params[1]] : [],
          name = req.params[0];
      if(params.length){
        this.callApi(params,req.session,req.body,function(err,response){
         if(err){
           res.json(err.message,500);
         } else {
           data = {
             data : _.extend(response,req.body),
             layout : false
           };
           logger.info('partial request complete.',req.timer);
           res.render('partials/' + name,data);
         }
        });
      } else {
        res.render('partials/'+name,{layout:false});
      }
    }.bind(this));
    // **View Route**
    // Renders a view
    app.all('/view/:name',function(req,res,next){
      data = {
        data: req.body,
        layout : false
      };
      res.render(req.params.name,data);
    });
    // **Main App Route**
    app.all("/*",function(req,res,next){
      if(this['default']){
        this.default.call(app,req,res,next);
      } else {
        var params = req.prams && req.params.split('/');
        res.render('main');
      }
    }.bind(this));
    // **404 Error Route**
    // this route always should go last, it will catch errors.
    app.all(/(.*)/,function(req,res){
      // TODO: make this prettier.
      res.send(404);
    });
    return app;
  }
}