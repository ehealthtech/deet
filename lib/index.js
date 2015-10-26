"use strict";

var util = require('util');
var fs = require('fs');
var Path = require('path');
var os = require('os');
var _ = require('lodash');
var Schemap = require('schemap');
var Promise = require('bluebird');
var Busboy = require('busboy');
var bodyParser = require('body-parser');
var helmet = require('helmet');
var xssFilters = require('xss-filters');
var hpp = require('hpp')();

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

    // We generally want to validate all JSON entering the system.
    // By default we don't check uploaded files that are JSON.
    // If you want to also include uploads as part of the
    // JSONSchema validation step, set this to true.
    //
    var validateUploadedJSON = false;

    // Whether route tokens (req#params) AND query parameters (req#query)
    // are run through an XSS sanitizer.
    //
    // @see #parseOtherIfAny
    //
    var sanitizeURLEncoded = !!opts.sanitizeURLEncoded || false;

    // https://github.com/analog-nico/hpp
    //
    var hppProtection = typeof opts.hppProtection === 'undefined'
        ? true
        : !!opts.hppProtection

    // This should be an Express #app
    //
    var app = opts.app;

    if(!app) {
        throw new Error('You must pass #app argument to @deet');
    }

    var tempUploadFolder = opts.tempUploadFolder || os.tmpDir();

    // TODO: test how this affects downloads!
    // http://blogs.msdn.com/b/ie/archive/2008/07/02/ie8-security-part-v-comprehensive-protection.aspx
    //app.use(helmet.ieNoOpen())

    // TODO: Does our server always set the right mimetype? if so, use this.
    //
    // app.use(helmet.noSniff());

    // Removes the X-Powered-By header from responses.
    //
    (typeof opts.hidePoweredBy === 'undefined' || !!opts.hidePoweredBy)
    && app.disable('x-powered-by');

    // Configure @helmet XSS options.
    //
    if(opts.xssFilters || typeof opts.xssCSP === 'object' || opts.xFrame) {

        // Enable @helmet XFrame protections
        //
        opts.xFrame
        && ~['deny','sameorigin','allow-from'].indexOf(opts.xFrame)
        && app.use(helmet.xframe(opts.xFrame));

        // Configure @helmet to set the X-XSS-Protection header
        //
        !!opts.xssFilter && app.use(helmet.xssFilter());

        // Configure @helmet options for Content Security Policy
        // http://content-security-policy.com/
        //
        // TODO: need to filter in cases of 'none' and '*'
        //
        opts.xssCSP && app.use(helmet.csp(['defaultSrc','scriptSrc','styleSrc','imgSrc','connectSrc','fontSrc','objectSrc','mediaSrc','frameSrc']
            .reduce(function(prev, next) {

                // For each of the @helmet CSP properties concatenate any
                // sent Array of rules into a space-separated string and
                // reduce to a map satisfying the @helmet#csp interface.
                //
                prev[next] = [].concat(opts.xssCSP[next] || []).join(' ');

                return prev;

            }, {})));
    }

    // Whether the key for the schema should be derived from the route definition.
    // e.g. if the bound route is /user/:first/:last and is a GET, the key
    // is `<req.method>_<encodeURIComponent(req.route.path)>`
    //
    var useRouteAsKey = typeof opts.useRouteAsKey === 'undefined'
        ? false
        : !!opts.useRouteAsKey;

    // TODO: add busboy limits
    //
    var limits = opts.limits || {};

    // If #useValidator is not set, a default will be used by Schemap
    //
    var schemap = Schemap({
        useValidator: opts.useValidator
    });

    function parseOtherIfAny(req) {

        var po = function(prev, next) {

            prev[next] = xssFilters.inHTMLData(prev[next]);
            return prev;
        };

        return new Promise(function(resolve, reject) {

            hppProtection && hpp(req, {}, function(){});

            if(sanitizeURLEncoded) {

                Object.keys(req.params).reduce(po, req.params);
                Object.keys(req.query).reduce(po, req.query);
            }

            jsonbody(req, {}, function() {
                resolve(_.merge({}, req.body, req.params, req.query));
            })
        });
    }

    function getMultipartIfAny(req) {
        return new Promise(function(resolve, reject) {

            var fieldJSON = {};

            try {

                var busboy = new Busboy({
                    headers: req.headers
                });

                busboy.on('file', function(fieldname, filestream, filename, encoding, mimetype) {

                    console.log('File [' + fieldname + ']: filename: ' + filename + ', encoding: ' + encoding + ', mimetype: ' + mimetype);

                    // To turn off file uploading, or to otherwise limit which uploads can be skipped:
                    // TODO: implement filestream.resume() for these files
                    // TODO: deal with buffers. Skip, use stream, something else?
                    //

                    req.files = req.files || {
                            file : {
                                fieldName : fieldname,
                                mimetype : mimetype,
                                originalname : filename,
                                encoding : encoding,
                                size : 0,
                                destination : tempUploadFolder,
                                filename : filename,
                                name: filename, // for convenience
                                path : Path.join(tempUploadFolder, filename),
                                extension : Path.extname(filename),
                                buffer : []
                            }
                        };

                    filestream.on('data', function(data) {
                        req.files.file.size += data.length;
                    });

                    filestream.pipe(fs.createWriteStream(req.files.file.path));

                });
                busboy.on('field', function(fieldname, val, fieldnameTruncated, valTruncated) {

                    console.log('Field [' + fieldname + ']: value: ' + util.inspect(val));

                    fieldJSON[fieldname] = val;
                });
                busboy.on('finish', function() {

                    console.log("file upload ended")

                    // This is where we fetch JSON uploads...
                    //
                    var fileJSON = {};

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

        getMultipartIfAny(req)
            .bind(this)
            .then(function(mpJSON) {

                req.validJSON = _.merge({}, mpJSON);

                return parseOtherIfAny(req);

            })
            .then(function(otherJSON) {

                req.validJSON = _.merge(req.validJSON, otherJSON);

                // If there is no schema to validate we're done.
                // This is typically true when @deet is used as middleware
                // e.g. app.use(deet()) <-- notice: no schema
                //
                if(!this.schema) {
                    return done();
                }

                // Validate JSONSchema
                //
                var sKey;

                // Schemas are compiled on first request
                //
                if(!this.compiledSchema) {

                    // Schemas are stored using a key. Which key?
                    //
                    if(useRouteAsKey) {
                        sKey = util.format('%s_%s',
                            req.method,
                            encodeURIComponent(req.originalUrl)
                        );
                    } else {
                        sKey = util.format('k_%d', ++schemaCount);
                    }

                    this.compiledSchema = schemap.set(sKey, this.schema);
                }

                if(this.compiledSchema(req.validJSON)) {
                    return done();
                };

                // Null invalid JSON
                //
                req.validJSON = null;

                res.status(400).json(this.compiledSchema.errors);

            })
            .catch(done);
    }

    return function schemaApiCaller(schema) {

        return schemaApiMain.bind({
            schema : schema,
            compiledSchema: null
        });
    }
};