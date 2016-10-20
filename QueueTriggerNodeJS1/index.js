
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

function google_places_to_reply_message(token, places)
{
    return new Promise((resolve,reject) => {
	if (places.results.length) {
            var reply_message = {
		"replyToken" : token,
		"messages"   : [
                    {
			"type" : "text",
			"text" : "最寄りのお店は「" + places.results[0].name + "」です"
                    },
		    {
			"type"      : "location",
			"title"     : places.results[0].name,
			"address"   : places.results[0].vicinity,
			"latitude"  : places.results[0].geometry.location.lat,
			"longitude" : places.results[0].geometry.location.lng
		    }
		]
            };
            resolve(reply_message);
	}
	else {
            var reply_message = {
		"replyToken" : token,
		"messages"   : [
                    {
			"type" : "text",
			"text" : "お店が見つかりません"
                    }
		]
            };
	    reject(reply_message);
	}
    });
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
                resolve(google_places_to_reply_message(event.replyToken, JSON.parse(body)));
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

function location_handler(context, event)
{
    return search_origin_bento_shop(context, event);
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
		var data = JSON.parse(body);
                var origin_menu_carousel = origin_menu_to_line_carousel(menu_choice(data.menu, 3))
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

/* for test: node index.js */


if (require.main === module) {
    var event = {
	message : {
	    latitude  : "35.683801",
	    longitude : "139.753945"
	},
	replyToken : "token",
    };
    var context = console;
    search_origin_bento_shop(context, event).then(msg => {
	console.log(msg);
    }).catch(msg => {
        console.log(msg);
    });
}
    
