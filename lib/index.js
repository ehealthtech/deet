"use strict";

var util = require('util');
var fs = require('fs');
var _ = require('lodash');
var Schemap = require('schemap');
var Promise = require('bluebird');
var Busboy = require('busboy');
var bodyParser = require('body-parser');

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

    // Whether the key for the schema should be derived from the route definition.
    // e.g. if the bound route is /user/:first/:last and is a GET, the key
    // is `<req.method>_<encodeURIComponent(req.route.path)>`
    //
    // NOTE: any truthy value will flag this as enabled.
    //
    var useRouteAsKey = typeof opts.useRouteAsKey === 'undefined' ? false : true;

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

			jsonbody(req, {}, function() {
				resolve(_.merge({}, req.body, req.params, req.query));
			})
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

			var validation = this.validate(req);
			
            if(validation) {
            	req.validatedPayload = this.JSON;
            	return done();
            };
            
			res.status(400).json(this.compiledSchema.errors);
			
			done();

        }.bind(this))
        .catch(done);
    }

    return function schemaApiCaller(schema) {

        return schemaApiMain.bind({

            schema : schema,

            // See below
            //
            compiledSchema: null,

            // See #schemaApiMain, and below
            //
            JSON : null,

            validate : function $validate(req) {

                if(!this.schema) {
                    console.log('Not validating......');
                    return;
                }

                var sKey;

                // Schemas are compiled on first request
                //
                if(!this.compiledSchema) {

                    // Schemas are stored using a key. Which key?
                    //
                    if( useRouteAsKey
                        && typeof req.route === 'object'
                        && typeof req.route.path === 'string'
                    ) {
                        sKey = util.format('%s_%s', req.method, encodeURIComponent(req.route.path));
                    } else {
                        sKey = util.format('k_%d', ++schemaCount);
                    }

                    this.compiledSchema = schemap.set(sKey, schema);
                }

                return this.compiledSchema(this.JSON);
            }
        });
    }
};