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

        //  Session Id for instance
        session = "",
        
        //  Host for discovery
        host = "localhost",
        
        //  Port for discovery
        port = 8081,

        //  Callback method interfaces to be used by API user. These methods are called on corresponding events
        callbacks = {
            handleAgentStatusChange : function(status, reason) {},
            handleFlowStatusChange : function(flowid, projectid, status) {},
            handleNewFlow : function(flowid, projectid) {},
            handleEndFlow : function(flowid, projectid) {},
            handleReschedule : function(flowid) { return {}; },
            handleConfirmResultCode : function(flowid) { return true; },
            handleResultCodeSuggestion : function(resultcode, flowid) { return true; },
            handleMandatoryResultCodeSelection : function(flowid) { return true; },
            handleFlowDisposition : function(flowid) { return {}; },
            handleConference : function(flowid) { return {}; },
            handleTransfer : function(flowid) { return {}; },
            handleContactRefreshed : function(flowid) { return {}; },
            handleConfigurationRefresh : function() {},
            handleLogout : function(status, result) {},
            handleLogin : function(status, result) {},
            handleValidateSession : function(status, result) {}
        },
        flows = [],
        activecall = "",
        defaultprojectid = 0,
        activechats = {},
        activecontact = {},
        projects = {},
        agent = {
            Status : {},
            Name : "",
            Username : "",
            TimeZone : "",
            Presence : {}
        },
        wssocket;


    var ccclogic = function (settings, credentials, port, host) {
        return new CCCLogic(settings, credentials, port, host);
    };

    function CCCLogic(settings, credentials, _port, _host) {
    	if (settings && settings.validate && settings.callbacks) {
    		if (localStorage.cccusername) {
    			if (settings.callbacks.handleValidateSession && 
    					typeof settings.callbacks.handleValidateSession === "function") {
    				settings.callbacks.handleValidateSession("success", {});
    				return;
    			}
    		}
    	}
        if (_port) {
			port = _port;
		}
		if (_host) {
			host = _host;
		}
		endpoint = "https://" + host + ":" + port + DISCOVERY_CONTEXT;
		
		//parse settings
		ccclogic.updateSettings(settings);
		
		if (credentials && credentials.username && credentials.password) {
			this.login(credentials.username, credentials.password);
		} else {
			if (localStorage.cccusername && localStorage.cccsession) {
				this.login(localStorage.cccusername, null, localStorage.cccsession);
			} else {
				callbacks.handleLogout("error", {});
			}
		}
    }

    //PRIVATE METHODS
    function createWSS() {
        wssocket = WebSocket ? new WebSocket( wsendpoint ) : {
            send: function(m){ return false },
            close: function(){}
        };
        $(window).unload(function(){ wssocket.close(); wssocket = null; });
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
                        } else if (m.Event === "LeadInfoAvailable" && callbacks.handleContactRefreshed) {
                            callbacks.handleContactRefreshed(m.Result.Id);
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
            success : function(response, status, xhr) {
                if (response.Result && (typeof response.Result === "object")) {
                    $.extend(agent, response.Result);
                }
            },
			error : function(xhr, response, e) {
				callbacks.handleLogout("Error", response);
           }
        });
    }

    function refreshProjects(async) {
        $.ajax({
            url : restendpoint + PROJECT_CONTEXT,
            type : "GET",
            async : async,
            success : function(response, status, xhr) {
                if (response.Result) {
                    if ($.isArray(response.Result)) {
                        projects = {};
                        $.each(response.Result, function(index, project) {
                            var _p = new Object();
                            _p[project.Id] = project;
                            $.extend(projects, _p);
                            if (project.IsDefault) {
                                defaultprojectid = project.Id;
                            }
                        });
                    }
                }
            },
			error : function(xhr, response, e) {
				callbacks.handleLogout("Error", response);
           }
        });
    }

    function refreshFlows(async) {
        $.ajax({
            url : restendpoint + CALL_CONTEXT,
            type : "GET",
            async : async,
            success : function(response, status, xhr) {
                if (response.Result) {
                    if ($.isArray(response.Result)) {
                        $.each(response.Result, function(index, flow) {
                            activecall = flow.Id;
                            flows.push(flow);
                        });
                    }
                }
            },
			error : function(xhr, response, e) {
				callbacks.handleLogout("Error", response);
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
                type : "POST",
                dataType : "json",
                contentType : "application/json",
                data : JSON.stringify({
                    "Command" : "Login",
                    "UserName" : username,
                    "Password" : password,
                    "SessionId" : session,
                    "Config" : {
                        "Cti" : true,
                        "Agent" : true,
                        "Forced" : true,
                        "Params" : ""
                    },
                    "DisconnectAfter" : 30000,
                }),
                success : function(response, status, xhr) {
					if (response && response.Result && response.Result.UserName && 
							response.Result.UserName === username.toUpperCase() &&
							response.Result.LoginResult && 
							response.Result.LoginResult.Status) {
						if (response.Result.LoginResult.Status === "AppRunning") {
							localStorage.cccusername = response.Result.UserName;
							localStorage.cccrestport = response.Result.HttpPort;
							localStorage.cccwsport = response.Result.WebSocketPort;
							localStorage.cccapiversion = response.Result.ApiVersion;
							localStorage.cccsession = response.Result.LoginResult.SessionId;
							callbacks.handleLogin("success", response.Result);
						} else if (response.Result.LoginResult.Status === "AppNotInstalled") {
							//TODO
						} else {
							callbacks.handleLogin("error", {});
						}
					} else if(response.Error){
   						callbacks.handleLogin("error", response.Error);
                    }
                },
				error : function(xhr, response, e) {
					callbacks.handleLogin("error", xhr.responseJSON.Error);
				}
            });
        },
        //  Logout function to log out of 3CLogic instance. It
        //  requires the username, forced, and the session token used to
        //  login to the instance.
        //  
        //  **username**: username
        //  **session**: unique token provided at the time of login
		//  **forced**: logout forcefully.
        logout : function(forced) {
            $.ajax({
                url : restendpoint + SYSTEM_CONTEXT,
                async : false,
                data : JSON.stringify({
				  "Command": "Exit",
				  "ExitParams": {
					"Console": true,
					"Forced": forced,
					"ShutdownReason": "By User",
					"Type": "Shutdown"
				  }
                }),
                success : function(response, status, xhr) {
                    if (response && response.Result && 
                    		response.Result.UserName) {
                    	restendpoint = "";
                        restport = 0;
                        wssocket.close(); wssocket = null;
                        localStorage.removeItem("cccusername");
                        localStorage.removeItem("cccsession");
                        localStorage.removeItem("cccwsport");
                        localStorage.removeItem("cccrestport");
                        localStorage.removeItem("cccapiversion");
                        callbacks.handleLogout("success", response.Result);
                    } else if(response && response.Error){
						if(response.Error.Status === 'FinalizationPending') {
							callbacks.handleLogout("error", response.Error);
						} else {
							callbacks.handleLogout("error", response);
						}
                    } else {
                    	callbacks.handleLogout("error", {});
                    }
                },
				error : function(xhr, response, e) {
					callbacks.handleLogout("error", response);
				}
            });
        },
        //  Gets the configuration for project identified by projectId
        //  The configuration will be fetched for only the projects to which
        //  logged in agent is assigned. Configuration includes ResultCodes, Project Variables,
        //  Name and attributes for the project.
        //
        //  **projectId**: Id of the project for which configuration is required.
        getProjectConfiguration : function(projectId) {
            if (projectId && projects && projects[projectId]) return projects[projectId];

            return {};
        },
        //  Returns the project id for the
        //  default project. Default project
        //  is the project where all manual
        //  calls will happen by default.
        getDefaultProject : function() {
            return defaultprojectid;
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
        changeAgentStatus : function(status, reason, callback) {
            $.ajax({
                url: restendpoint + AGENT_CONTEXT + "/presence",
                data: JSON.stringify({"Id": status, "Reason" : reason}),
                success : function(response, status, xhr) {
                    if (typeof callback === "function") callback("success", response);
                },
                error : function(xhr, response, e) {
                    if (typeof callback === "function") callback("error", response);
                }
            });
        },
        getFlow : function(flowid, callback) {
            $.get(flowUrl(flowid), function(response) {
                if (response.Result) {
                    if (typeof response.Result === "object" &&
                        (typeof callback === "function")) {
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
                success : function(response, status, xhr) {
                    if (typeof callback === "function") callback("success", response);
                },
                error : function(xhr, response, e) {
                    if (typeof callback === "function") callback("error", response);
                }
            });
        },
        searchAndDial : function(contactfields, dialpolicy, searchfields, callback) {
            $.ajax({
                url: restendpoint + PROJECT_CONTEXT + "/" + dialpolicy.ProjectId + "/calls",
                data: JSON.stringify({
                    "Command": "CallToLead",
                    "LeadRequest": {
                        "DialingDetails":[{
                            "Key": "dialphone",
                            "Value": dialpolicy.DialPhone
                        }],
                        "Fields": contactfields,
                        "SearchableFields": searchfields,
                        "Timeout": dialpolicy.Timeout,
                        "UpdateLeadIfFound": true
                    }
                }),
                success : function(response, status, xhr) {
                    if (typeof callback === "function") callback("success", response);
                },
                error : function(xhr, response, e) {
                    if (typeof callback === "function") callback("error", response);
                }
            });
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
        schedule : function(flowid, timezone, selfassigned, startdatetime, enddatetime, callback) {
            $.ajax({
                url : flowUrl(flowid),
                async : false,
                data : JSON.stringify({
                    "Command" : "Schedule",
                    "ScheduleParams" : {
                        "Start" : startdatetime,
                        "IsSelfAssigned" : selfassigned,
                        "TimeZone" : timezone
                    }
                }),
                success : function(response, status, xhr) {
                    if (typeof callback === "function") callback("success", response);
                },
                error : function(xhr, response, e) {
                    if (typeof callback === "function") callback("error", response);
                }
            });
        },
        transfer : function(to, type, flowid, callback) {
        	$.ajax({
				url: flowUrl(flowid),
                data: JSON.stringify({"Command": "Transfer", "Uri" : to}),
                success : function(response) {
                    if (typeof callback === "function") callback("success", response.Result);
                },
                error : function(response) {
                    if (typeof callback === "function") callback("error", response.responseText);
                }
            });
        },
        conference : function(to, type, flowid) {
            //TODO
            console.log("To Be Implemented");
        },
        dtmf : function(flowid, number) {
            $.ajax({
                url : flowUrl(flowid),
                data : JSON.stringify({
                    "Command" : "Dtmf",
                    "PhoneNumber" : number
                })
            });
        },
		init : function() {
			if (localStorage && localStorage.cccusername) {
				restport = localStorage.cccrestport;
				wsport = localStorage.cccwsport;
				apiversion = localStorage.cccapiversion;
				session = localStorage.cccsession;
				username = localStorage.cccusername;
				
				$.ajaxSetup({
					type : "POST",
					dataType : "json",
					contentType : "application/json",
					processData : false,
					async : true,
					cache : false,
					headers : {
						"X-CCC-Session" : session
					}
				});
	
				//store wsendpoint, restendpoint, username, session
				wsendpoint = "wss://" + host + ":" + wsport;
				restendpoint = "https://" + host + ":" + restport + "/ccclogic/api/" + apiversion + "/";
				
				//initialize a webworker to monitor websocket
				createWSS();
				refreshConfiguration();
			} else {
				callbacks.handleLogout("error", {});
			}
		},
		refreshing : function(){
			$.ajax({
                url : restendpoint + SYSTEM_CONTEXT + "/refreshing",
                async : false,
                type : "GET"
			});
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