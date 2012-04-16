var wt = require("fs-watch-tree");
var cp = require("child_process");
var util = require("util");
var glob = require("buster-glob");
var path = require("path");

function throttle(ms, callback, thisp) {
    var timer;
    return function () {
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () { callback.apply(thisp, args); }, ms);
    };
}

function addTestOption(argv, files) {
    for (var i = 0, l = argv.length; i < l; ++i) {
        if (argv[i] === "-t" || argv[i] === "--tests") {
            var arguments = argv.slice();
            arguments[i + 1] += "," + files.join(",");
            return arguments;
        }
    }
    return argv.concat(["-t", files.join(",")]);
}

function printHeader() {
    var now = new Date();
    util.puts("\n");
    util.puts(now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds() + " Running tests");
    util.puts("``````````````````````");
}

exports.watch = function (dir, options) {
    var running = false;
    var failed = false;
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
        if (running) return;
        running = true;
        findFiles(event, function (files) {
            printHeader();
            var test = cp.spawn("buster-test", prepareOptions(files));

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
                var currentFailed = !!code;
                running = false;
                var runAll = failed && !currentFailed;
                failed = currentFailed;
                if (runAll) { runTests(); }
            });
        });
    }

    var run = throttle(10, runTests);

    wt.watchTree(dir, { exclude: [/\/\./, "#", "node_modules"] }, function (e) {
        if (e.isMkdir()) { return; }
        run(e);
    });
};
