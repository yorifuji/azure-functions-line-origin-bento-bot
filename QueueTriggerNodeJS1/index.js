
var https = require("https");
var querystring = require('querystring');

var message_handler = [
    {
        "type"    : "location",
        "handler" : location_handler
    },
    {
        "type"    : "text",
        "handler" : message_handler
    }
];

function make_date_str() {
    var d = new Date();
    d.setTime(d.getTime() + 1000 * 60 * 60 * 9); // UTC --> JST

    var year  = d.getFullYear();
    var month = d.getMonth() + 1;
    var date  = d.getDate();
    var hour  = d.getHours();
    var min   = d.getMinutes();

    if (month < 10) month = '0' + month;
    if (date  < 10) date  = '0' + date;
    if (hour  < 10) hour  = '0' + hour;
    if (min   < 10) min   = '0' + min;

    return [year, month, date, hour, min].reduce((pre, cur) => pre + cur.toString());
}

function make_yahoo_api_map_rainfall_url(lat, lon) {
    const yahoo_api_map_url = "http://map.olp.yahooapis.jp/OpenLocalPlatform/V1/static?";
    const zoom   = 11;
    const width  = 600;
    const height = 800;
    const query_str = querystring.stringify({
        "appid"   : process.env.YAHOO_APP_ID,
        "lat"     : lat,
        "lon"     : lon,
        "z"       : zoom,
        "width"   : width,
        "height"  : height,
        "pointer" : "on",
        "mode"    : "map",
        "overlay" : "type:rainfall|datelabel:on|date:" + make_date_str()
    });
    return yahoo_api_map_url + query_str;
}

function location_handler(context, event) {

    const url = make_yahoo_api_map_rainfall_url(event.message.latitude, event.message.longitude);
    context.log(url);

    return new Promise((resolve, reject) => {
        var req = https.request({
            host: 'www.googleapis.com',
            path: '/urlshortener/v1/url?key=' + process.env.GOOGLE_API_KEY,
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
        }, res => {
            var body = '';
            res.on('data', chunk => {
                body += chunk.toString();
            });
            res.on('end', () => {
                var d = JSON.parse(body);
                var reply_message = {
                    "replyToken" : event.replyToken,
                    "messages"   : [
                        {
                            "type" : "text",
                            "text" : `「${event.message.address}」の雨雲の様子`
                        },
                        {
                            "type"               : "image",
                            "originalContentUrl" : d.id,
                            "previewImageUrl"    : d.id
                        }
                    ]
                };
                resolve(reply_message);
            });
            res.on('error', err => {
                var reply_message = {
                    "replyToken" : event.replyToken,
                    "messages"   : [
                        {
                            "type" : "text",
                            "text" : err.message
                        }
                    ]
                };
                reject(reply_message);
            });
        });
        req.write(JSON.stringify({"longUrl" : url}));
        req.end();
    });
}

function origin_menu_to_line_carousel(menu_list)
{
    var columns = menu_list.map(menu => (
        {
            "thumbnailImageUrl" : menu.image, 
            "title"             : "Title:" + menu.title,
            "text"              : "Text:"  + menu.title,
            "actions"           : [
                {
                    "type"  : "uri",
                    "label" : "view detail",
                    "uri"   : menu.url
                }
            ]
        }
    ));
    
    return [
        {
            "type"     : "template",
            "altText"  : "origin menu choice",
            "template" : {
                "type"    : "carousel",
                "columns" : columns
            }
        }
    ];
}

function make_random_choice(num, max)
{
    var choice = [];
    while (choice.length != num) {
        var r = Math.floor(Math.random() * max);
        if (choice.indexOf(r) == -1) choice.push(r);
    }
    return choice;
}

function menu_choice(menu_list, pick_num) {
    return make_random_choice(pick_num, menu_list.length).map(idx => menu_list[idx]);
}
    
function get_origin_menu(context, event) {
    return new Promise((resolve, reject) => {
        var req = https.get(process.env.ORIGIN_BENTO_API_URL, res => {
            var body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => {
                body += chunk;
            });
            res.on("end", res => {
                var origin_menu_carousel = oigin_menu_to_line_carousel(menu_choice(JSON.parse(body), 3))
                var reply_message = {
                    "replyToken" : event.replyToken,
                    "messages"   : origin_menu_carousel
                };
                resolve(reply_message);
            });
        }).on("error", err => {
            var reply_message = {
                "replyToken" : event.replyToken,
                "messages"   : [
                    {
                        "type" : "text",
                        "text" : err.message
                    }
                ]
            };
            resolve(reply_message);
        });
    });
}

var keyword_handlers = [
    {
        keyword : ["オリジン", "おりじん", "オリジン東秀", "東秀"],
        handler : get_origin_menu
    }
];

function message_handler(context, event) {
    for (var kh of keyword_handlers) {
        for (var keyword of kh.keyword) {
            if (keyword == event.message.text) {
                return kh.handler(context, event);
            }
        }
    }
    return new Promise((resolve, reject) => {
        var reply_message = {
            "replyToken" : event.replyToken,
            "messages"   : [
                {
                    "type" : "text",
                    "text" : event.message.text,
                }
            ]
        };
        resolve(reply_message);
    });
}

module.exports = function (context, myQueueItem) {
    context.log('Node.js queue trigger function processed work item', myQueueItem);

    var message_events = myQueueItem.events.filter(event => event.type == "message");

    var task = [];
    message_events.forEach(event => {
        for (var mh of message_handler) {
            if (mh.type == event.message.type) {
                task.push(mh.handler(context, event));
                break;
            }
        }
    });

    Promise.all(task).then(reply_messages => {
        context.bindings.outputQueueItem = { "replyMessages" :  reply_messages };
        context.log(context.bindings.outputQueueItem);
        context.done();
    }).catch(err => {
        context.log(err);
        context.done();
    });
};
