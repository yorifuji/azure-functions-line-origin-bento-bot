
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

function make_google_places_url(lat, lon, name) {

    const google_places_api_url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json?";
    const query_str = querystring.stringify({
        "key"      : process.env.GOOGLE_API_KEY,
        "location" : lat + "," + lon,
        "name"     : name,
        "rankby"   : "distance",
        "language" : "ja",
        "type"     : "food"
    });
    return google_places_api_url + query_str;
}

function google_place_to_line_location_message(place)
{
    return [
        {
            "type" : "text",
            "text" : "最寄りのお店は「" + place.name + "」です"
        },
        {
            "type"      : "location",
            "title"     : place.name,
//          "title"     : "最寄りのお店は「" + place.name + "」です",
            "address"   : place.vicinity,
            "latitude"  : place.geometry.location.lat,
            "longitude" : place.geometry.location.lng
        }
    ];
}

function search_origin_bento_shop(context, event)
{    
    var lat = event.message.latitude;
    var lon = event.message.longitude;
    
    //const name = "オリジン弁当 キッチンオリジン"; // 複数ワードに対応していない？？
    const name = "オリジン";
    const url = make_google_places_url(lat, lon, name);
    
    return new Promise((resolve, reject) => {
        var req = https.get(url, res => {
            var body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => {
                body += chunk;
            });
            res.on("end", () => {
                resolve(JSON.parse(body));
            });
        }).on("error", err => {
            reject(err);
        });
    });
}

function location_handler(context, event)
{
    return new Promise((resolve,reject) => {
        var task = [
            search_origin_bento_shop(context, event),
            call_origin_bento_menu_api(context, event)
        ];
        Promise.all(task).then(res => {
            var msgs1 = google_place_to_line_location_message(res[0].results[0]);
            var msgs2 = origin_menu_to_line_carousel(menu_choice(res[1].menu, 3));
            msgs2.push(
                {
                    "type" : "text",
                    "text" : "その他のメニュー" + res[1].url
                }
            );
            resolve(
                {
                    "replyToken" : event.replyToken,
                    "messages"   : msgs1.concat(msgs2)
                }
            );
        }).catch(res => {
            var reply_message = {
                "replyToken" : event.replyToken,
                "messages"   : [
                    {
                        "type" : "text",
                        "text" : "お店が見つかりません"
                    }
                ]
            };
            reject(reply_message);
        });
    });
}

function origin_menu_to_line_carousel(menu_list)
{
    var columns = menu_list.map(menu => (
        {
            "thumbnailImageUrl" : menu.image, 
            "title"             : menu.title,
            "text"              : menu.price_t,
            "actions"           : [
                {
                    "type"  : "uri",
                    "label" : "詳細",
                    "uri"   : menu.url
                }
            ]
        }
    ));
    
    return [
        {
            "type" : "text",
            "text" : "今日のオススメはこちら！"
        },
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
    
function call_origin_bento_menu_api(context, event) {
    return new Promise((resolve, reject) => {
        var req = https.get(process.env.ORIGIN_BENTO_API_URL, res => {
            var body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => {
                body += chunk;
            });
            res.on("end", res => {
                resolve(JSON.parse(body));
            });
        }).on("error", err => {
            reject(err);
        });
    });
}

function get_origin_bento_menu(context, event)
{
    return new Promise((resolve,reject) => {
        var task = [
            call_origin_bento_menu_api(context, event)
        ];
        Promise.all(task).then(res => {
            var messages = origin_menu_to_line_carousel(menu_choice(res[1].menu, 3));
            messages.push(
                {
                    "type" : "text",
                    "text" : ["メニュー一覧はこちら", res[1].url].join("\n")
                }
            );
            resolve(
                {
                    "replyToken" : event.replyToken,
                    "messages"   : messages
                }
            );
        }).catch(res => {
            var reply_message = {
                "replyToken" : event.replyToken,
                "messages"   : [
                    {
                        "type" : "text",
                        "text" : "メニューが取得できませんでした"
                    }
                ]
            };
            reject(reply_message);
        });
    });
}

var keyword_handlers = [
    {
        keyword : ["menu", "めにゅー", "メニュー"],
        handler : get_origin_bento_menu
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

/* for test: node index.js */

if (require.main === module) {
    _main();
}

function _main()
{
    var event = {
        message : {
            latitude  : "35.683801",
            longitude : "139.753945"
        },
        replyToken : "token",
    };
    var context = console;
    location_handler(context, event).then(res => {
        console.log(res);
    }).catch(res => {
        console.log(res);
    });
}
