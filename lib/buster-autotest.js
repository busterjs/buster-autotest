var wt = require("fs-watch-tree");
var cp = require("child_process");
var util = require("util");

function throttle(ms, callback, thisp) {
    var timer;
    return function () {
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () { callback.apply(thisp, args); }, ms);
    };
}

function addTestOption(argv, name) {
    for (var i = 0, l = argv.length; i < l; ++i) {
        if (argv[i] === "-t" || argv[i] === "--tests") {
            var arguments = argv.slice();
            arguments[i + 1] += "," + name;
            return arguments;
        }
    }
    return argv.concat(["-t", name]);
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

    function prepareOptions(event) {
        var argv = options.argv || [];
        if (event && event.name) {
            var name = event.name + (event.isDirectory() ? "/*" : "");
            argv = addTestOption(argv, name);
        }
        return argv;
    }

    function runTests(event) {
        if (running) return;
        printHeader();
        running = true;
        var test = cp.spawn("buster-test", prepareOptions(event));

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
            util.puts("\n\n\n");
            running = false;
            var runAll = failed && !currentFailed;
            failed = currentFailed;
            if (runAll) { runTests(); }
        });
    }

    var run = throttle(10, runTests);

    wt.watchTree(dir, { exclude: [/^\./, "#", "node_modules"] }, function (e) {
        if (e.isMkdir()) { return; }
        run(e);
    });
};
