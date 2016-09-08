#!/usr/bin/env node

var fs     = require('fs')
var join   = require('path').join
var shasum = require('crypto').createHash('sha1')

var colors = require('colors/safe')
var kexec  = require('kexec')
var posix  = require('posix')
var prompt = require('prompt')

var getFreeUID = require('./lib/getFreeUID')

var initUser
try
{
  initUser = require('logon-initUser')
}
catch(e)
{
  initUser = null
}


var config;
var HOME;

var uid, gid;

var tries_username = 3
var tries_password = 3


function hashPassword(value)
{
  // Password is empty string, don't hash and use it literal
  if(value === '') return ''

  return shasum.update(value).digest('hex')
}

function createUser(username, password, callback)
{
  fs.mkdir(HOME, function(error)
  {
    if(error) throw error

    getFreeUID(HOME, function(error, uid)
    {
      if(error) throw error

      fs.chown(HOME, uid, uid, function(error)
      {
        if(error) throw error

        // Create /etc/logon.json
        var config =
        {
          password: hashPassword(password)
        }

        fs.writeFile(join(HOME, '/etc/logon.json'), JSON.stringify(config),
        function(error)
        {
          if(error) throw error

          initUser(HOME, callback)
        })
      })
    })
  })
}

function askPassword()
{
  return prompt.history('create user').value
}

function failure(pending, error)
{
  prompt.message = ''

  this.message = error.message || error

  if(!pending) process.exit()
}

function askCreateUser(username)
{
  var schema =
  {
    properties:
    {
      'create user':
      {
        type: 'boolean',
        value: 'The user ' + username + ' does not exist. Would you like to create it?',
        required: true,
        default: false
      },
      password:
      {
        type: 'string',
        required: true,
        hidden: true,
        allowEmpty: true,
        ask: askPassword
      },
      'confirm password':
      {
        type: 'string',
        required: true,
        hidden: true,
        allowEmpty: true,
        ask: askPassword,
        conform: function(value)
        {
          return value === prompt.history('password').value
        }
      }
    }
  }

  // ask the user if they want to create the account
  prompt.get(schema, function(error, result)
  {
    if(error) return failure(--tries_username, error)

    // They don't want to create the account, fail
    if(!result['create user'])
      return failure(--tries_username, 'Aborted creation of user "'+username+'"')

    // Create the account
    createUser(username, result.password)
  })
}

function startRepl(prompt)
{
  /* eslint-disable no-console */
  console.log('Starting REPL session')

  require('repl').start(prompt+'> ').on('exit', function()
  {
    console.log('Got "exit" event from repl!')
    process.exit(2)
  });
  /* eslint-enable no-console */
}


var schema_username =
{
  type: 'string',
  required: true,
  conform: function(value)
  {
    if(prompt.message.length) prompt.message = '·'+' '.repeat(17)

    // Get user's $HOME directory
    HOME = '/home/'+value

    try
    {
      var statsHome = fs.statSync(HOME)
    }
    catch(err)
    {
      if(err.code != 'ENOENT') throw err

      if(initUser) return askCreateUser(value)

      return failure.call(schema_username, --tries_username, 'User '+value+' not found')
    }

    // Get user's logon configuration
    var logon = HOME+'/etc/logon.json'

    try
    {
      var stats = fs.statSync(logon)
    }
    catch(err)
    {
      if(err.code != 'ENOENT') throw err

      // The folder exists but not the config file: it's not an user `$HOME`
      return failure.call(schema_username, --tries_username, 'User '+value+' not found')
    }

    uid = stats.uid
    gid = stats.gid

    try
    {
      // Security check
      if(statsHome.uid != uid || statsHome.gid != gid)
        throw HOME+" uid & gid don't match with its logon config file"

      config = require(logon)
    }
    catch(error)
    {
      return failure.call(schema_username, --tries_username, error)
    }

    // Check if account is password-less (for example, a guest account)
    var password = config.password
    if(password === '')
    {
      prompt.override = prompt.override || {}
      prompt.override.password = ''

      return true
    }

    if(typeof password == 'string') return true

    // User don't have defined a password, it's a non-interactive account
    failure.call(schema_username, --tries_username, 'Non-interactive account')
  }
}

var schema_password =
{
  type: 'string',
  required: true,
  hidden: true,
  allowEmpty: true,
  conform: function(value)
  {
    var password = config.password

    var result = password === ''
              || password === hashPassword(value)
    if(result) return true

    failure.call(schema_password, --tries_password, 'Invalid password')
  }
}

var schema =
{
  properties:
  {
    username: schema_username,
    password: schema_password
  }
}


//
// Start the prompt
//
var NodeOS = colors.blue('N')+colors.cyan('ode')+colors.blue('OS')
prompt.start({message: 'Welcome to '+NodeOS+'!'})

//
// Get two properties from the user: username and password
//
prompt.get(schema, function(err)
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

  var shell = config.shell
  if(shell)
    try
    {
      kexec(shell, config.shellArgs || [])
    }
    catch(error)
    {
      console.error(error)
    }

  // kexec failed or shell not defined, start REPL
  startRepl('logon')
})
