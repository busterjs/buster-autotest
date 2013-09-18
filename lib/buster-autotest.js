var wt = require("fs-watch-tree");
var cp = require("child_process");
var util = require("util");
var glob = require("multi-glob");
var path = require("path");
var oi = require("./on-interrupt");

function throttle(ms, callback, thisp) {
    var timer;
    return function () {
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () { callback.apply(thisp, args); }, ms);
    };
}

function addTestOption(argv, files) {
    var i, l, args;
    for (i = 0, l = argv.length; i < l; ++i) {
        if (argv[i] === "-t" || argv[i] === "--tests") {
            args = argv.slice();
            args[i + 1] += "," + files.join(",");
            return args;
        }
    }
    return argv.concat(["-t", files.join(",")]);
}

var clearScreen = "\x1b[1;1H\x1b[2J";

function zeroPad(num) {
    return num < 10 ? "0" + num : num;
}

function printHeader() {
    var now = new Date();
    var time = zeroPad(now.getHours()) + ":" +
            zeroPad(now.getMinutes()) + ":" +
            zeroPad(now.getSeconds());
    util.puts(clearScreen + time + " Running tests");
}

function success(code) {
    return code === 0;
}

exports.watch = function (dir, options) {
    var running = false;
    options = options || {};

    function findFiles(event, callback) {
        if (!event || !event.name || event.isDirectory()) {
            return callback([]);
        }
        var pieces = path.basename(event.name).split(".");
        pieces.pop();
        var base = pieces.join(".");
        glob.glob([
            "{test{,s},spec{,s}}/**/*" + base + "*.js"
        ], function (err, paths) {
            paths.push(event.name);
            callback(paths);
        });
    }

    function prepareOptions(files) {
        var argv = options.argv || [];
        if (files.length > 0) { argv = addTestOption(argv, files); }
        return argv;
    }

    function runTests(event) {
        if (running) { return; }
        running = true;
        findFiles(event, function (files) {
            printHeader();
            var command = (options.cmd || "buster-test").replace(/([^\\]) /g, "$1\\ ");
            var test = cp.spawn(command, prepareOptions(files));

            var cancel = throttle(1000, function () {
                running = false;
                test.kill();
            });

            function onData(data) {
                util.print(data.toString());
                cancel();
            }

            test.stdout.on("data", onData);
            test.stderr.on("data", onData);

            test.on("exit", function (code) {
                running = false;
            });
        });
    }

    var run = throttle(10, runTests);

    wt.watchTree(dir, { exclude: [/\/\./, "#", "node_modules"] }, function (e) {
        if (e.isMkdir()) { return; }
        run(e);
    });

    oi.onInterrupt("Running all tests.", run);
};
