var Promise = require('bluebird'),
    mongoose = require('mongoose'),
    builder = require('xmlbuilder'),
    slug = require('slug'),
    config = require('./lib/config'),
    fs = require('fs'),
    prob = 0,
    xml = builder.create('sessions');

Promise.promisify(config.load)()
    .then(function () {
        if (config.get) {
            var dburl = 'mongodb://' +
                config.get.mongodb.host + ':' +
                config.get.mongodb.port + '/' +
                config.get.mongodb.dbname;
            mongoose.connect(dburl);
            mongoose.model('Channel', require('./models/channel').Channel);
            mongoose.model('Package', require('./models/package').Package);
            mongoose.model('Stream', require('./models/stream').Stream);
            console.log('Connected to MongoDB at', dburl);
        }
    })
    .then(function () {
        return mongoose.model('Package').find({});
    })
    .then(function (pkgs) {
        prob = 100 / pkgs.length;
        console.log('popularity: ', prob);
        return pkgs;
    })
    .map(function (pkg) {
        var pkgxml = xml.ele('session', {name: slug(pkg.title) + '-' + pkg.uuid, type: 'ts_http', probability: prob});
        pkgxml.ele('request').ele('http', {version: '1.1', method: 'GET', url: '/packages.json'});
        pkgxml.ele('thinktime', {value: 10, random: true});
        pkgxml.ele('request').ele('http', {version: '1.1', method: 'GET', url: '/packages/' + pkg.uuid + '.json'});
        pkgxml.ele('thinktime', {value: 10, random: true});
        return mongoose.model('Channel').find({ package_uuid: pkg.uuid })
            .then(function (channels) {
                return channels;
            })
            .map(function (channel) {
                pkgxml.ele('request').ele('http', {
                    version: '1.1',
                    method: 'GET',
                    url: '/channels/' + channel.uuid + '.json'
                });
                pkgxml.ele('thinktime', {value: 10, random: true});
                return mongoose.model('Stream').find({channel_uuid: channel.uuid})
                    .then(function (streams) {
                        pkgxml.ele('request').ele('http', {
                            version: '1.1',
                            method: 'GET',
                            url: '/channels/' + channel.uuid + '/streams.json'
                        });
                        pkgxml.ele('thinktime', {value: 5, random: true});
                        return Promise.map(streams, function (stream) {
                            var frameBlocks = Math.ceil(stream.frameCount / 2000);
                            var trans = pkgxml.ele('transaction', {name: slug(channel.title + ' ' + stream.title) + '-' + stream.uuid});
                            for (var i = 0; i < frameBlocks; i+=1) {
                                trans.ele('request').ele('http', {
                                    version: '1.1',
                                    method: 'GET',
                                    url: '/streams/' + stream.uuid + '.json?from=' + (i * 500) + '&to=' + ((i + 1) * 500)
                                });
                            }
                        }, {concurrency: 1});
                    });
            }, {concurrency: 1})
            .then(function () {
                pkgxml.ele('thinktime', {value: 10, random: true});
            });
    }, {concurrency: 1})
    .then(function () {
        var out = xml.end({pretty: true});
        console.log('done.');
        fs.writeFileSync('sessions.xml', out);
        process.exit(0);
    });