"use strict";
var fs = require('fs');
var crypto = require('crypto');

var Steam = require('steam');
var SteamWebLogOn = require('steam-weblogon');
var getSteamAPIKey = require('steam-web-api-key');
var SteamTradeOffers = require('steam-tradeoffers');

var admin = '76561198061679866';

var logOnOptions = {
    account_name: 'angel9_21',
    password: '02744609'
};

var authCode = 'GF5J9'; // code received by email

module.exports = function() {
    try {
        logOnOptions.sha_sentryfile = getSHA1(fs.readFileSync('sentry'));
    } catch (e) {
        if (authCode !== '') {
            logOnOptions.auth_code = authCode;
        }
    }

    // if we've saved a server list, use it
    if (fs.existsSync('servers')) {
        Steam.servers = JSON.parse(fs.readFileSync('servers'));
    }

    var steamClient = new Steam.SteamClient();
    var steamUser = new Steam.SteamUser(steamClient);
    var steamFriends = new Steam.SteamFriends(steamClient);
    var steamWebLogOn = new SteamWebLogOn(steamClient, steamUser);
    var offers = new SteamTradeOffers();

    steamClient.connect();
    steamClient.on('connected', function() {
        steamUser.logOn(logOnOptions);
    });

    function offerItems() {
        offers.loadMyInventory({
            appId: 440,
            contextId: 2
        }, function(err, items) {
            var item;
            // picking first tradable item
            for (var i = 0; i < items.length; i++) {
                if (items[i].tradable) {
                    item = items[i];
                    break;
                }
            }
            // if there is such an item, making an offer with it
            if (item) {
                offers.makeOffer ({
                    partnerSteamId: admin,
                    itemsFromMe: [
                        {
                            appid: 440,
                            contextid: 2,
                            amount: 1,
                            assetid: item.id
                        }
                    ],
                    itemsFromThem: [],
                    message: 'This is test'
                }, function(err, response) {
                    if (err) {
                        throw err;
                    }
                    console.log(response);
                });
            }
        });
    }

    steamClient.on('logOnResponse', function(logonResp) {
        if (logonResp.eresult === Steam.EResult.OK) {
            console.log('Logged in!');
            steamFriends.setPersonaState(Steam.EPersonaState.Online);

            steamWebLogOn.webLogOn(function(sessionID, newCookie) {
                getSteamAPIKey({
                    sessionID: sessionID,
                    webCookie: newCookie
                }, function(err, APIKey) {
                    offers.setup({
                        sessionID: sessionID,
                        webCookie: newCookie,
                        APIKey: APIKey
                    });
                    //offerItems();
                    handleOffers();
                });
            });
        }
    });

    steamClient.on('servers', function(servers) {
        fs.writeFile('servers', JSON.stringify(servers));
    });

    steamUser.on('updateMachineAuth', function(sentry, callback) {
        fs.writeFileSync('sentry', sentry.bytes);
        callback({ sha_file: getSHA1(sentry.bytes) });
    });

    steamUser.on('tradeOffers', function(number) {
        if (number > 0) {
            handleOffers();
        }
    });

    function handleOffers() {
        offers.getOffers({
            get_received_offers: 1,
            active_only: 1,
            time_historical_cutoff: Math.round(Date.now() / 1000),
            get_descriptions: 1
        }, function(error, body) {
            if (error) {
                return log(error);
            }

            if (
                body
                && body.response
                && body.response.trade_offers_received
            ) {
                var descriptions = {};

                body.response.descriptions = body.response.descriptions || [];

                body.response.descriptions.forEach(function (desc) {
                    descriptions[
                        desc.appid + ';' + desc.classid + ';' + desc.instanceid
                    ] = desc;
                });

                body.response.trade_offers_received.forEach(function (offer) {
                    if (offer.trade_offer_state !== 2) {
                        return;
                    }

                    var offerMessage = 'Got an offer ' + offer.tradeofferid +
                    ' from ' + offer.steamid_other + '\n';

                    if (offer.items_to_receive) {
                        offerMessage += 'Items to receive: ' +
                        offer.items_to_receive.map(function (item) {
                            var desc = descriptions[
                                item.appid + ';' + item.classid + ';' + item.instanceid
                            ];
                            return desc.name + ' (' + desc.type + ')';
                        }).join(', ') + '\n';
                    }

                    if (offer.items_to_give) {
                        offerMessage += 'Items to give: ' +
                        offer.items_to_give.map(function (item) {
                            var desc = descriptions[
                                item.appid + ';' + item.classid + ';' + item.instanceid
                            ];
                            return desc.name + ' (' + desc.type + ')';
                        }).join(', ') + '\n';
                    }

                    if (offer.message && offer.message !== '') {
                        offerMessage += 'Message: ' + offer.message;
                    }

                    log(offerMessage);

                    if (offer.steamid_other === admin || !offer.items_to_give) {
                        offers.acceptOffer({
                            tradeOfferId: offer.tradeofferid
                        }, function (error, result) {
                            if (error) {
                                return log(error);
                            }

                            log('Offer ' + offer.tradeofferid + ' accepted');

                            offers.getOffer({
                                tradeofferid: offer.tradeofferid
                            }, function (error, result) {
                                if (error) {
                                    return log(error);
                                }

                                if (result
                                    && result.response
                                    && result.response.offer
                                    && result.response.offer.tradeid
                                ) {
                                    offers.getItems({
                                        tradeId: result.response.offer.tradeid
                                    }, function (error, result) {
                                        if (error) {
                                            return log(error);
                                        }

                                        var items = 'Got items:\n' +
                                        result.map(function (item) {
                                            return 'http://steamcommunity.com/profiles/' +
                                            item.owner + '/inventory/#' +
                                            item.appid + '_' + item.contextid + '_' + item.id;
                                        }).join('\n');

                                        log(items);
                                    });
                                }
                            });
                        });
                    } else {
                        offers.declineOffer({
                            tradeOfferId: offer.tradeofferid
                        }, function (error, result) {
                            if (error) {
                                return log(error);
                            }

                            log('Offer ' + offer.tradeofferid + ' declined');
                        });
                    }
                });
            }
        });
    }

    function log (message) {
        console.log(new Date().toString() + ' - ' + message);
        steamFriends.sendMessage(admin, message.toString());
    }

    function getSHA1(bytes) {
        var shasum = crypto.createHash('sha1');
        shasum.end(bytes);
        return shasum.read();
    }
}
