#!/usr/bin/env node

var fs     = require('fs')
var shasum = require('crypto').createHash('sha1')

var kexec  = require('kexec')
var posix  = require('posix')
var prompt = require('prompt')


function startRepl(prompt)
{
  console.log('Starting REPL session')

  require('repl').start(prompt+'> ').on('exit', function()
  {
    console.log('Got "exit" event from repl!')
    process.exit(2)
  });
}

function failure(pending, error)
{
  if(error) console.error(error.message || error)

  if(!pending) process.exit()
}


var config;
var HOME;

var uid, gid;

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
          var statsHome = fs.statSync(HOME)
        }
        catch(err)
        {
          if(err.code != 'ENOENT') throw err
          return failure(--tries_username, 'User '+value+' not found');
        }

        // Get user's logon configuration
        var logon = HOME+'/etc/logon.json'

        var stats = fs.statSync(logon);

        uid = stats.uid;
        gid = stats.gid;

        try
        {
          if(statsHome.uid != uid || statsHome.gid != gid)
            throw HOME+" uid & gid don't match with its logon config file"

          config = require(logon)
        }
        catch(error)
        {
          return failure(--tries_username, error);
        }

        // Check if account is password-less (for example, a guest account)
        var password = config.password
        if(password === '')
        {
          prompt.override = prompt.override || {}
          prompt.override.password = ''

          return true
        }

        if(typeof password == 'string') return true;

        // User don't have defined a password, it's a non-interactive account
        failure(--tries_username, 'Non-interactive account')
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

        var result = password === ''
                  || password === shasum.update(value).digest('hex')
        if(result) return true

        failure(--tries_password)
      }
    }
  }
}


//
// Start the prompt
//
var NodeOS = 'N'.blue+'ode'.cyan+'OS'.blue
prompt.start({message: 'Welcome to '+NodeOS+'!'})

//
// Get two properties from the user: username and password
//
prompt.get(schema, function(err, result)
{
  if(err) return

  posix.chroot(HOME)

  // Set process real UID & GID to don't leak permissions in case of error
  // executing the shell and starting a REPL
  posix.setregid(gid, gid)
  posix.setreuid(uid, uid)

  // $PATH environment varible used INSIDE the kexeced process. By default it's
  // the same of the currect process, that's already defined to `/bin`. I left
  // this here for reference if in the future this could be defined in
  // `config.json` file
//  process.env.PATH = '/bin'

  kexec(config.shell, config.shellArgs || [])

  // kexec failed, start REPL
  startRepl('logon')
})
