
var https = require("https");

function ping(context, url) {
    return new Promise(function(resolve, reject) {
        https.get(url + "&ping=" + Date.now(), function(res){
            var body = '';
            res.on('data', function(chunk){
                body += chunk;
            });
            res.on('end', function(res){
                resolve(res);
            });
        }).on('error', function(e){
            reject(e);
        });
    });
}

module.exports = function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    
    if(myTimer.isPastDue)
    {
        context.log('Node.js is running late!');
    }
    context.log('Node.js timer trigger function ran!', timeStamp);

    ping(context, process.env.PING_TARGET_URL).then((res) => {
        context.log(res);
        context.done();
    }).catch(err => {
        context.log(err);
        context.done();
    });
       
};
