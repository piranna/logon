var fs = require('fs')

var map = require('async/map')


function getUID(item, callback)
{
  fs.stat(item, function(error, stat)
  {
    if(error) return callback(error)

    // Ignore folders where UID and GID don't match
    if(stat.uid !== stat.gid) return callback()

    callback(null, stat.uid)
  })
}

function notNull(item)
{
  return item != null
}

function reduceUID(prev, item)
{
  if(prev === item) prev++

  return prev
}


function getFreeUID(path, callback)
{
  fs.readdir(path, function(error, files)
  {
    if(error) return callback(error)

    map(files, getUID, function(error, results)
    {
      if(error) return callback(error)

      callback(null, results.filter(notNull).sort().reduce(reduceUID, 1))
    })
  })
}


module.exports = getFreeUID
