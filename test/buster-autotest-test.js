var buster = require("buster-node");
var assert = buster.referee.assert;
var refute = buster.referee.refute;
var autotest = require("../lib/buster-autotest");
var chokidar = require('chokidar');
var cp = require("child_process");
var util = require("util");
var path = require("path");
var glob = require("multi-glob");
var oi = require("../lib/on-interrupt");
var events = require("events");

buster.testCase("Autotest", {
    setUp: function () {
        this.stub(oi, "onInterrupt");
        var self = this;
        this.stdout = "";
        this.stub(util, "print", function (str) { self.stdout += str; });
        this.stub(util, "puts", function (str) { self.stdout += str + "\n"; });
        this.processes = [];
        this.stub(cp, "spawn", function () {
            var process = new events.EventEmitter();
            process.kill = self.spy();
            process.stdout = new events.EventEmitter();
            process.stderr = new events.EventEmitter();
            self.processes.push(process);
            self.process = process;
            return process;
        });
        this.watcher = {
            on: this.stub()
        };
        this.stub(chokidar, "watch", function () { return self.watcher; });
        this.stub(glob, "glob").yields(null, []);
        this.clock = this.useFakeTimers();
    },

    "watches directory": function () {
        autotest.watch("/some/dir");
        assert.calledOnceWith(chokidar.watch, "/some/dir");
    },

    "on change": {
        setUp: function () {
            var self = this;
            this.emit = function (event, file, opt) {
                opt = opt || {};
                var args = self.watcher.on.args;
                var indexOfEvent = -1;
                var i;
                for (i = 0; i < args.length; i++) {
                    if (args[i][0] === event) {
                        indexOfEvent = i;
                        break;
                    }
                }
                if (indexOfEvent === -1) {
                    throw new Error("No handler registered for: " + event);
                }
                self.watcher.on.args[indexOfEvent][1](file, {
                    isDirectory: function () {
                        return opt.isDir;
                    }
                });
            };
            this.emitChange = this.emit.bind(null, "change");
            this.failTests = function () { this.process.emit("exit", 1); };
            this.passTests = function () { this.process.emit("exit", 0); };
        },

        "does not run tests immediately": function () {
            autotest.watch("/some/dir");
            this.emitChange();
            refute.called(cp.spawn);
        },

        "does not run tests for mkdir event": function () {
            autotest.watch("/some/dir");
            assert.exception(
                this.emit.bind(null, "addDir", "test"),
                { message: "No handler registered for: addDir" }
            );
        },

        "runs tests after 10ms": function () {
            autotest.watch("/some/dir");
            this.emitChange();
            this.clock.tick(10);
            assert.calledOnce(cp.spawn);
            assert.calledWith(cp.spawn, "buster-test");
        },

        "runs specific test": function () {
            autotest.watch("/some/dir");
            this.emitChange("some/file.js");
            this.clock.tick(10);
            assert.calledWith(cp.spawn, "buster-test", ["-t", "some/file.js"]);
        },

        "runs all tests when name is unavailable": function () {
            autotest.watch("/some/dir");
            this.emitChange();
            this.clock.tick(10);
            assert.calledWith(cp.spawn, "buster-test", []);
        },

        "runs all tests when directory": function () {
            autotest.watch("/some/dir");
            this.emitChange("test", { isDir: true });
            this.clock.tick(10);
            assert.calledWith(cp.spawn, "buster-test", []);
        },

        "adds changed test file to existing -t argument": function () {
            autotest.watch("/some/dir", { argv: ["-t", "file.js"] });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            assert.calledWith(
                cp.spawn,
                "buster-test",
                ["-t", "file.js,test/thing-test.js"]
            );
        },

        "uses --tests if present": function () {
            autotest.watch("/some/dir", { argv: ["--tests", "file.js"] });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            assert.calledWith(
                cp.spawn,
                "buster-test",
                ["--tests", "file.js,test/thing-test.js"]
            );
        },

        "runs with all provided options": function () {
            autotest.watch("/some/dir", {
                argv: ["-r", "specification", "--tests", "file.js", "--node"]
            });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            assert.calledWith(
                cp.spawn,
                "buster-test",
                [
                    "-r",
                    "specification",
                    "--tests",
                    "file.js,test/thing-test.js",
                    "--node"
                ]
            );
        },

        "does not run if already running": function () {
            autotest.watch("/some/dir", { argv: ["--tests", "file.js"] });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);

            assert.calledOnce(cp.spawn);
        },

        "issues new run when previous is completed": function () {
            autotest.watch("/some/dir", { argv: ["--tests", "file.js"] });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.process.emit("exit");
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);

            assert.calledTwice(cp.spawn);
        },

        "kills test process after 1 second": function () {
            autotest.watch("/some/dir", { argv: ["--tests", "file.js"] });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.process.stdout.emit("data", "Running...");
            this.clock.tick(1000);

            assert.calledOnce(this.process.kill);
        },

        "runs tests after killing process": function () {
            autotest.watch("/some/dir", { argv: ["--tests", "file.js"] });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.process.stdout.emit("data", "Running...");
            this.clock.tick(1000);
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);

            assert.calledTwice(cp.spawn);
        },

        "runs all tests when passing after failing": function () {
            autotest.watch("/some/dir");
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.failTests();
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.passTests();

            assert.calledThrice(cp.spawn);
            assert.calledWith(cp.spawn, "buster-test", []);
        },

        "runs originally selected tests when pass after fail": function () {
            autotest.watch("/some/dir", { argv: ["-t", "test/boing.js"] });
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.failTests();
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.passTests();

            assert.calledThrice(cp.spawn);
            assert.calledWith(cp.spawn, "buster-test", ["-t", "test/boing.js"]);
        },

        "does not run all tests when failing after passing": function () {
            autotest.watch("/some/dir");
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.passTests();
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.failTests();

            assert.calledTwice(cp.spawn);
        },

        "does not re-run all tests after all passing": function () {
            autotest.watch("/some/dir");
            this.emitChange("test/thing-test.js");
            this.clock.tick(10);
            this.passTests();
            this.clock.tick(10);

            assert.calledOnce(cp.spawn);
        },

        "runs related test files": function () {
            glob.glob.restore();
            this.stub(glob, "glob").yields(null,
                ["test/buster-autotest-test.js"]);
            autotest.watch(path.join(__dirname, "../"));
            this.emitChange("lib/buster-autotest.js");
            this.clock.tick(10);

            assert.calledWith(cp.spawn, "buster-test", [
                "-t",
                "test/buster-autotest-test.js,lib/buster-autotest.js"
            ]);
        }
    }
});
