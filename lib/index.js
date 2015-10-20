"use strict";

var util = require('util');
var fs = require('fs');
var _ = require('lodash');
var Schemap = require('schemap');
var Promise = require('bluebird');
var Busboy = require('busboy');
var bodyParser = require('body-parser');

var urlencoded = bodyParser.urlencoded({
    extended: true
});
var jsonbody = bodyParser.json({
    strict: false
});

module.exports = function(opts) {

    // Configure general options on initialization
    // TODO: options for setting maximums (payload size, fields, etc)
    //
    if(!_.isPlainObject(opts || {})) {
        throw new Error('deet constructor received non-Object as argument');
    }

    // Simple id counter. See returned function at bottom.
    //
    var schemaCount = 1;

    // TODO: add busboy limits
    //
    var limits = opts.limits || {};

    // If #useValidator is not set, a default will be used by Schemap
    //
    var schemap = Schemap({
        useValidator: opts.useValidator
    });

    function parseOtherIfAny(req) {
        return new Promise(function(resolve, reject) {

            urlencoded(req, {}, function() {
                jsonbody(req, {}, function() {
                    resolve(_.merge({}, req.body, req.params));
                })
            });
        });
    }

    function getMultipartIfAny(req) {
        return new Promise(function(resolve, reject) {

            var fileJSON = {};
            var fieldJSON = {};

            try {

                var busboy = new Busboy({
                    headers: req.headers
                });

                busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {

                    // Only interested in JSON files. Note that a non-json file can
                    // still be sent by spoofing types. That situation is corrected
                    // below when the stream end is handled.
                    //
                    if(mimetype !== 'application/json') {
                        return file.resume();
                    }

                    var jbody = '';

                    console.log('File [' + fieldname + ']: filename: ' + filename + ', encoding: ' + encoding + ', mimetype: ' + mimetype);
                    file.on('data', function(data) {
                        jbody += data.toString();
                        console.log('File [' + fieldname + '] got ' + data.length + ' bytes');

                    });
                    file.on('end', function() {
                        console.log('File [' + fieldname + '] Finished');

                        try {
                            fileJSON = JSON.parse(jbody);

                        } catch(e) {};
                    });
                });
                busboy.on('field', function(fieldname, val, fieldnameTruncated, valTruncated) {

                    console.log('Field [' + fieldname + ']: value: ' + util.inspect(val));

                    fieldJSON[fieldname] = val;
                });
                busboy.on('finish', function() {

                    resolve(_.merge({}, fileJSON, fieldJSON));
                });
                busboy.on('error', function(err) {

                    reject(err);
                })

                req.pipe(busboy);

            } catch(e) {
                resolve({});
            }
        })
    }

    function schemaApiMain(req, res, done) {

        if(req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end('OPTIONS HERE');

            return Promise.resolve();
        }

        getMultipartIfAny(req)
        .then(function(mpJSON) {

            this.JSON = _.merge({}, mpJSON);

            return parseOtherIfAny(req);

        }.bind(this))
        .then(function(otherJSON) {

            this.JSON = _.merge(this.JSON, otherJSON);

            this.validate(req)

            done();

        }.bind(this))
        .catch(done);
    }

    return function schemaApiCaller(schema) {

        var sKey = util.format('k_%d', ++schemaCount);

        return schemaApiMain.bind({

            compiledSchema : schema ? schemap.set(sKey, schema) : null,

            validate : function validateAndContinue(req) {

                if(!this.compiledSchema) {
                    console.log('Not validating......');
                    return;
                }
console.log('JZON->', this.JSON)
                var validation = this.compiledSchema(this.JSON);
                req.validatedPayload = validation ? this.JSON : null;
                req.validationError = !validation
                    ? JSON.stringify(this.compiledSchema.errors)
                    : null;
            }
        });
    }
};