"use strict";

var fs = require('fs');

var japi = require('../lib/index.js')({
    validator: 'ajv'
});
var express = require('express');
var app = express();

var sampleSchema = require(__dirname + '/assets/sampleschema.json');

app.post('/', japi(sampleSchema), function(req, res) {

    console.log('** validated ->', req.validatedPayload);
    console.log('** validation error ->', req.validationError);

    res.status(200).json(req.validatedPayload);
});

app.get('/test/:firstname/:lastname', japi(sampleSchema), function(req, res) {

    console.log('** validated ->', req.validatedPayload);
    console.log('** validation error ->', req.validationError);

    res.status(200).json(req.validatedPayload);
})

app.get('/jquery', function(req, res) {

    fs.createReadStream(__dirname + '/assets/jquery.min.js').pipe(res);
});

app.get('/', function(req, res) {
    res.writeHead(200, {
        Connection: 'close'
    });
    fs.createReadStream(__dirname + '/assets/form.html').pipe(res);
});

app.listen(2112, function() {
    console.log('Server listening on 2112');
});