var chokidar = require('chokidar');
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
        timer = setTimeout(function () {
            callback.apply(thisp, args);
        }, ms);
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
    var lastResult = 0;
    options = options || {};

    function findFiles(file, stats, callback) {

        if (!file || (stats && stats.isDirectory())) {
            return callback([]);
        }

        var pieces = path.basename(file).split(".");
        pieces.pop();
        var base = pieces.join(".");
        glob.glob([
            "{test{,s},spec{,s}}/**/*" + base + "*.js"
        ], function (err, paths) {
            paths.push(file);
            callback(paths);
        });
    }

    function prepareOptions(files) {
        var argv = options.argv || [];
        if (files.length > 0) {
            argv = addTestOption(argv, files);
        }
        return argv;
    }

    function runTests(file, stats) {
        if (running) {
            return;
        }
        running = true;
        findFiles(file, stats, function (files) {
            printHeader();
            var command = (options.cmd || "buster-test").replace(/([^\\]) /g,
                    "$1\\ ");
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
                if (success(code) && !success(lastResult) && files.length > 0) {
                    runTests();
                }
                lastResult = code;
            });
        });
    }

    var run = throttle(10, runTests);

    function exclude(patterns) {
        return function (path) {
            return patterns.some(function (pattern) {
                return path.match(pattern);
            });
        };
    }

    var watcher = chokidar.watch(dir, {
        ignored : exclude([ /\/\./, "#", "node_modules" ]),
        persistent : true
    });
    watcher.on('add', function (file) {
        run(file);
    });
    watcher.on('change', function (file, stats) {
        run(file, stats);
    });
    watcher.on('unlink', function (file) {
        run(file);
    });

    oi.onInterrupt("Running all tests.", run);
};
