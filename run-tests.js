var buster = require("buster-node");

buster.testRunner.onCreate(function (runner) {
    buster.referee.on("pass", runner.assertionPass.bind(runner));

    runner.on("suite:end", function (results) {
        if (!results.ok) {
            setTimeout(function () {
                process.exit(1);
            }, 50);
        }
    });
});

buster.testContext.on("create", buster.autoRun());

require("./test/buster-autotest-test");
