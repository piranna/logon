#!/usr/bin/env node

var fs = require('fs')
var spawn = require('child_process').spawn
var shasum = require('crypto').createHash('sha1');

var prompt = require('prompt');


function startRepl(prompt)
{
  console.log('Starting REPL session')

  require('repl').start(prompt+'> ').on('exit', function()
  {
    console.log('Got "exit" event from repl!');
    process.exit(2);
  });
}

function failure(pending)
{
  if(pending) return;

  process.exit()
}


var config;
var HOME;

var tries_username = 3
var tries_password = 3


var schema =
{
  properties:
  {
    username:
    {
      type: 'string',
      required: true,
      conform: function(value)
      {
        // Get user's $HOME directory
        HOME = '/home/'+value

        try
        {
          fs.statSync(HOME)
        }
        catch(err)
        {
          if(err.code != 'ENOENT') throw err
          return failure(tries_username--);
        }

        // Get user's logon configuration
        var logon = '/home/'+value+'/etc/logon.json'

        try
        {
          config = require(logon)
        }
        catch(err)
        {
          return failure(--tries_username);
        }

        var password = config.password
        if(password == '')
        {
          prompt.override = prompt.override || {}
          prompt.override.password = ''

          return true
        }

        var result = typeof password == 'string'
        if(result) return true;

        failure(--tries_username)
      }
    },
    password:
    {
      type: 'string',
      required: true,
      hidden: true,
      allowEmpty: true,
      conform: function(value)
      {
        var password = config.password

        var result = password == ''
                  || password == shasum.update(value).digest('hex')
        if(result) return true

        failure(--tries_password)
      }
    }
  }
};

//
// Start the prompt
//
prompt.message = 'Welcome to NodeOS!'.rainbow;
prompt.start();

//
// Get two properties from the user: username and password
//
prompt.get(schema, function(err, result)
{
  if(err) return;

  var env =
  {
    HOME: HOME,
    PATH: HOME+'/bin:/usr/bin',
    __proto__: process.env
  }

  spawn(config.shell, [],
  {
    stdio: 'inherit',
    detached: true,

    cwd: HOME,
    env: env
  })
  .on('error', function(error)
  {
    console.error(error)

    startRepl('logon')
  })
  .on('exit', function(code)
  {
    process.exit(code);
  });
});
