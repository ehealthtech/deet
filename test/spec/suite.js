"use strict";

var fs = require('fs');
var util = require('util');
var Path = require('path');
var superagent = require('superagent-bluebird-promise');

module.exports = function(test, Promise) {

    var goodSample = this.goodSample;
    var badSample = this.badSample;
    var sampleSchema = this.sampleSchema;
    var server = this.express.server;

    test.ok(this.express.server, 'Received Express server');
    test.ok(this.express.app, 'Received Express app');

    return new Promise(function(resolve, reject) {

        superagent
        .get('localhost:2112')
        .promise()
        .catch(function(err) {

            test.fail(util.format('Cannot get test index.html page: %s %s', err.message, JSON.stringify(err.originalError)));
        })
        .then(function(result) {

            test.pass('Got test index.html page');

            return superagent
                    .post('localhost:2112')
                    .set('Content-Type', 'application/json')
                    .send(goodSample)

        })
        .catch(function(err) {

            test.fail(util.format('Cannot POST goodSample: %s %s', err.message, JSON.stringify(err.originalError)));
        })
        .then(function(response) {

            test.deepEqual(response.body.validated, goodSample, 'Correctly validated goodSample');

            return superagent
                .post('localhost:2112')
                .set('Content-Type', 'application/json')
                .send(badSample)
        })
        .catch(function(err) {

            test.fail(util.format('Cannot POST badSample: %s %s', err.message, JSON.stringify(err.originalError)));
        })
        .then(function(response) {

            test.ok(response.body.errored, 'Correctly rejected badSample');

            return superagent.get('localhost:2112/test/mary/poppins');
        })
        .catch(function(err) {

            test.fail(util.format('Cannot GET GOOD /test/route: %s %s', err.message, JSON.stringify(err.originalError)));
        })
        .then(function(response) {

            test.ok(response.body.validated, 'Correctly validated using route vars :firstName/:lastName');

            return superagent.get('localhost:2112/test/3/poppins');
        })
        .catch(function(err) {

            test.fail(util.format('Cannot GET BAD /test/route: %s %s', err.message, JSON.stringify(err.originalError)));
        })
        .then(function(response) {

            test.ok(response.body.errored, 'Integer in :firstname correctly caused rejection of JSON');
        })
        .finally(function() {

                test.comment('Shutting down Express server');

                server.close();

                // Test is over
                //
                resolve();
        });

    })
};
/*
40, 251,252,256,269
    */