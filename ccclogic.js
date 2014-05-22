//     ccclogic.js 0.0.1
//     http://www.3clogic.com
//     (c) 2014-2020 3CLogic Inc., Pradeep Mishra (pmishra@3clogic.com), Nitin Gupta (ngupta@3clogic.com)
//     ccclogic CTI adaptor can be freely distributed under the MIT license
(function (window, $){
    //  Baseline setup
    //  --------------

    //  Discovery URL context to search the running instances
    var DISCOVERY_CONTEXT = "/ccclogic/api/discovery/instances",

        //  URL context to get agent configuration
        AGENT_CONTEXT = "agent",

        //  URL context to get projects configuration
        PROJECT_CONTEXT = "projects",

        //  URL context to get flows
        CALL_CONTEXT = "flows",

        // URL context to get lead fields
        CONTACT_CONTEXT = "/lead/fields",

        //  URL context to get system context
        SYSTEM_CONTEXT = "system",

        //  API version
		VERSION = "0.0.1";

    //  Create endpoint object to store instance URL
    var endpoint = "",

        // Object to store web socket endpoint for instance
        wsendpoint = "",

        // Object to store REST endpoint for instance
        restendpoint = "",

        // Object to store REST endpoint port
        restport = 0,

        //  Object to store web socket port
        wsport = 0,

        //  API version suggested by instance
        apiversion = 0,

        //  Callback method interfaces to be used by API user. These methods are called on corresponding events
        callbacks = {
            handleAgentStatusChange : function(status, reason) {},
            handleFlowStatusChange : function(flowid, projectid, status) {},
            handleMuteStatusChange : function(flowid, projectid) {},//TODO remove this and corresponding event
            handleNewFlow : function(flowid, projectid) {},
            handleEndFlow : function(flowid, projectid) {},
            handleReschedule : function(flowid) { return {}; },
            handleConfirmResultCode : function(flowid) { return true; },
            handleResultCodeSuggestion : function(resultcode, flowid) { return true; },
            handleMandatoryResultCodeSelection : function(flowid) { return true; },
            handleFlowDisposition : function(flowid) { return {}; },
            handleConference : function(flowid) { return {}; },
            handleTransfer : function(flowid) { return {}; },
            handleConfigurationRefresh : function() {},
            handleLogout : function() {},
            handleLogin : function() {}
        },
        flows = [],
        activecall = "",
        activechats = {},
        projects = {},
        agent = {
            Status : {},
            Name : "",
            Username : "",
            TimeZone : "",
            Presence : {}
        },
        wssocket;


    var ccclogic = function (username, password, session, settings, port, host) {
        return new CCCLogic(username.toUpperCase(), password, session, settings, port, host);
    };

    function CCCLogic(username, password, session, settings, port, host) {
        if (!port) {
            port = 8081;
        }
        if (!host) {
            host = "localhost";
        }
        endpoint = "https://" + host + ":" + port + DISCOVERY_CONTEXT;
        $.ajaxSetup({
            type : "POST",
            dataType : "json",
            contentType : "application/json",
            processData : false,
            async : true,
            cache : false
        });
        
        //parse settings
        ccclogic.updateSettings(settings);
        //login
        this.login(username, password, session);
        //store wsendpoint, restendpoint, username, session
        wsendpoint = "wss://" + host + ":" + wsport;
        restendpoint = "https://" + host + ":" + restport + "/ccclogic/api/" + apiversion + "/";
        //initialize a webworker to monitor websocket
        createWSS();
        refreshConfiguration();
    }

    //PRIVATE METHODS
    function createWSS() {
        wssocket = WebSocket ? new WebSocket( wsendpoint ) : {
            send: function(m){ return false },
            close: function(){}
        };
        $(window).unload(function(){ wssocket.close(); wssocket = null });
        $(wssocket)
            .bind("message", function(e){
                try {
                    var m = JSON.parse(e.originalEvent.data);
                    if (m.Entity === "Agent" && m.Event === "PresenceChanged") { 
                        $.extend(agent.Status, {"Id" : m.Result.Id, "Reason" : m.Result.Reason});
                        if (callbacks.handleAgentStatusChange) 
                            callbacks.handleAgentStatusChange(m.Result.Id, m.Result.Reason);
                    } else if (m.Entity === "Flow") {
                        if (m.Event === "NewFlow") {
                            activecall = m.Result.Id;
                            flows.push(m.Result.Id);
                            if (callbacks.handleNewFlow)
                                callbacks.handleNewFlow(m.Result.Id, m.Result.ProjectId);
                        } else if (m.Event === "FlowStatusUpdated" && callbacks.handleFlowStatusChange) {
                            callbacks.handleFlowStatusChange(m.Result.Id, m.Result.ProjectId, m.Result.Status);
                        } else if (m.Event === "FlowEnded" && callbacks.handleEndFlow) {
                            if (activecall === m.Result.Id) activecall = "";
                            flows = $.grep(flows, function(index, flow){
                                return flow != m.Result.Id;
                            });
                            callbacks.handleEndFlow(m.Result.Id, m.Result.ProjectId);
                        } else if (m.Event === "CallMuteStatusUpdated" && callbacks.handleMuteStatusChange) {
                            callbacks.handleMuteStatusChange(m.Result.Id, m.Result.ProjectId);
                        }
                    }
                } catch (error) { }
            });
    }

    function refreshConfiguration() {
        refreshProjects(false);
        refreshAgent(false);
        refreshFlows(false);
    }

    function refreshAgent(async) {
        $.ajax({
            url : restendpoint + AGENT_CONTEXT,
            type : "GET",
            async : async,
            success : function(response) {
                if (response.Result && (typeof response.Result === "object")) {
                    $.extend(agent, response.Result);
                }
            }
        });
    }

    function refreshProjects(async) {
        $.ajax({
            url : restendpoint + PROJECT_CONTEXT,
            type : "GET",
            async : async,
            success : function(response) {
                if (response.Result) {
                    if ($.isArray(response.Result)) {
                        projects = {};
                        $.each(response.Result, function(index, project) {
                            var _p = new Object();
                            _p[project.Id] = project;
                            $.extend(projects, _p);
                        });
                    }
                }
            }
        });
    }

    function refreshFlows(async) {
        $.ajax({
            url : restendpoint + CALL_CONTEXT,
            type : "GET",
            async : async,
            success : function(response) {
                if (response.Result) {
                    if ($.isArray(response.Result)) {
                        $.each(response.Result, function(index, flow) {
                            activecall = flow.Id;
                            flows.push(flow);
                        });
                    }
                }
            }
        });
    }

    function flowUrl(flowid) {
        return (flowid ? restendpoint + CALL_CONTEXT + "/" + flowid : restendpoint + CALL_CONTEXT + "/active");
    }

    //LIBRARY VARIABLES
    ccclogic.version = VERSION;
    ccclogic.TRANSFER_TYPES = [
        "TRANSFER"
    ];
    ccclogic.CONFERENCE_TYPES = [
        "BARGEIN",
        "WHISPER",
        "CONFERENCE",
        "WARM_TRANSFER"
    ];

    //LIBRARY METHODS
    ccclogic.updateSettings = function(settings) {
        if (settings && settings.callbacks) {
            $.extend(true, callbacks, settings.callbacks);
        }
    }

    //  API Functions
    //  -----------
    ccclogic.fn = CCCLogic.prototype = {
        //  Login function to login to 3CLogic instance. If the
        //  user is logged in, will return with current status
        //  of instance for user.
        //  
        //  **username**: username
        //  **password**: password
        //  **session**: Randomly generated unique token to identify running instance
        login : function(username, password, session) {
            $.ajax({
                url : endpoint,
                async : false,
                data : JSON.stringify({
                    "Command" : "Login",
                    "UserName" : username,
                    "Password" : password,
                    "Token" : session,
                    "Config" : {
                        "Cti" : true,
                        "Agent" : true,
                        "Forced" : true,
                        "Params" : ""
                    },
                    "DisconnectAfter" : 30000
                }),
                success : function(response) {
                    if (response && response.Result) {
                        if (response.Result.UserName && response.Result.UserName === username) {
                            restport = response.Result.HttpPort;
                            wsport = response.Result.WebSocketPort;
                            apiversion = response.Result.ApiVersion;
                        }
                    }
                }
            });
        },
        //  Logout function to log out of 3CLogic instance. It
        //  requires the username and the session token used to
        //  login to the instance.
        //  
        //  **username**: username
        //  **session**: unique token provided at the time of login
        logout : function(username, session) {
            $.ajax({
                url : endpoint,
                async : false,
                data : JSON.stringify({
                    "Command" : "Logout",
                    "UserName" : username,
                    "Token" : session
                }),
                success : function(response) {
                    if (response && response.Result) {
                        if (response.Result.UserName && response.Result.UserName === username) {
                            restendpoint = "";
                            restport = 0;
                            wssocket.close(); wssocket = null;
                            config.handleLogout();
                        }
                    }
                }
            });
        },
        getProjectConfiguration : function(projectId) {
            if (projectId && projects && projects[projectId]) return projects[projectId];

            return {};
        },
        getProjectResultCodes : function(projectId) {
            if (projectId && projects && projects[projectId] && projects[projectId].ResultCodes) return projects[projectId].ResultCodes;

            return {};
        },
        getAgentConfiguration : function() {
            if (agent) return agent;

            return {};
        },
        getAgentStatus : function() {
            if (agent) return agent.Status;

            return {};
        },
        getActiveFlow : function() {
            //TODO handle this for multiple calls
            if (activecall !== "") return flows[0];
            return {Id : ""};
        },
        changeAgentStatus : function(status, reason) {
            $.ajax({
                url: restendpoint + AGENT_CONTEXT + "/presence",
                data: JSON.stringify({"Id": status, "Reason" : reason})
            });
        },
        getFlow : function(flowid, callback) {
            $.get(flowUrl(flowid), function(response) {
                if (response.Result) {
                    if (typeof response.Result === "object") {
                        callback(response.Result);
                    }
                }
            });
        },
        getContact : function(flowid, callback) {
            $.get(flowUrl(flowid) + CONTACT_CONTEXT, function(response) {
                if (response.Result) {
                    if ($.isArray(response.Result)) {
                        var _c = {};
                        $.each(response.Result, function(index, field) {
                            var _l = new Object();
                            _l[field.Name] = field.Value;
                            $.extend(_c, _l);
                        });
                        var contact = {"Id" : flowid, "ContactFields" : _c};
                        callback(contact);
                    }
                }
            });            
        },
        updateContact : function(flowid, contactfields, callback) {
            $.ajax({
                url: flowUrl(flowid) + CONTACT_CONTEXT,
                data: JSON.stringify(contactfields),
                success : function(response) {
                    if (typeof callback === "function") callback("success", response);
                },
                error : function(response) {
                    if (typeof callback === "function") callback("error", response);
                }
            });
        },
        searchAndDial : function(contactfields, dialpolicy, search) {
            //TODO
        },
        dial : function(uri) {
            //TODO
        },
        pickUp : function(flowid) {
            //TODO
            console.log("To Be Implemented");
        },
        disconnect : function(flowid) {
            $.ajax({
                url: flowUrl(flowid),
                data: JSON.stringify({"Command" : "Disconnect"})
            });
        },
        changeMuteStatus : function(flowid, mute) {
            $.ajax({
                url: flowUrl(flowid),
                data: JSON.stringify({"Command" : (mute?"UnMute":"Mute")})
            });
        },
        changeHoldStatus : function(flowid, hold) {
            $.ajax({
                url: flowUrl(flowid),
                data: JSON.stringify({"Command" : (hold?"UnHold":"Hold")})
            });
        },
        call : function(flowid) {
            $.ajax({
                url: flowUrl(flowid),
                data: JSON.stringify({"Command" : "Call"})
            });
        },
        finalize : function(flowid, resultcode) {
            $.ajax({
                url : flowUrl(flowid),
                async : false,
                data : JSON.stringify({
                    "Command":"WrapUp", 
                    "WrapUpParams":{
                        "Result":resultcode
                    }
                })
            });
        },
        schedule : function(flowid, background, startutc, endutc) {
            var scheduleTime = {};
            if (!background) {
                scheduleTime = callbacks.handleReschedule();
            } else {
                if (!startutc) startutc = "";
                if (!endutc) endutc = "";
                scheduleTime = {startutc : startutc, endutc : endutc};
            }
            //TODO
            console.log("To Be Implemented");
            console.log(scheduleTime);
        },
        transfer : function(transferTo, transferType, flowid) {
            //TODO
            console.log("To Be Implemented");
        },
        conference : function(conferenceWith, conferenceType, flowid) {
            //TODO
            console.log("To Be Implemented");
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ccclogic;
    } else if (typeof define === "function" && define.amd) {
        define("ccclogic", function (require, exports, module) {
            return ccclogic;
        });
    } else {
    	if (!window.ccclogic) {
    		window.ccclogic = ccclogic;
    	}
    }
})(this, jQuery);