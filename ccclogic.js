//     ccclogic.js 0.0.1
//     http://www.3clogic.com
//     (c) 2014-2020 3CLogic Inc., Pradeep Mishra (pmishra@3clogic.com), Nitin Gupta (ngupta@3clogic.com)
//     ccclogic CTI adaptor can be freely distributed under the MIT license
(function (window, $){
    //  Baseline setup
    //  --------------

    //  Discovery URL context to search the running instances
    var DISCOVERY_CONTEXT = "/ccclogic/api/discovery/instances",
	
		DISCOVERY_SYSTEM_CONTEXT="/ccclogic/api/discovery/system",

        //  URL context to get agent configuration
        AGENT_CONTEXT = "agent",

        //  URL context to get projects configuration
        PROJECT_CONTEXT = "projects",

        //  URL context to get flows
        CALL_CONTEXT = "flows",

        // URL context to get lead fields
        CONTACT_CONTEXT = "/lead/fields",
		
		// URL context to set call fields
        FIELDS_CONTEXT = "/fields",

        //  URL context to get system context
        SYSTEM_CONTEXT = "system",

        //  API version
		VERSION = "0.0.1";

    //  Create endpoint object to store instance URL
    var endpoint = "",

        // Object to store web socket endpoint for instance
        wsendpoint = "",
		
		// Object to store discovery web socket endpoint for instance
		wsdendpoint = "";

        // Object to store REST endpoint for instance
        restendpoint = "",

        // Object to store REST endpoint port
        restport = 0,

        //  Object to store web socket port
        wsport = 0,

        //  API version suggested by instance
        apiversion = 0,

		// Object to listen login/logout port
		wsdport = 2011,
		
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
            handleResultCodeSuggestion : function(resultcode, flowid) {},
            handleFlowDisposition : function(flowid) { return {}; },
            handleConference : function(flowid) { return {}; },
            handleTransfer : function(flowid) { return {}; },
            handleContactRefreshed : function(flowid) { return {}; },
            handleConfigurationRefresh : function() {},
            handleLogout : function(status, result) {},
            handleLogin : function(status, result) {},
            handleValidateSession : function(status, result) {},
			handleError : function(status, result) {},
			handleCrash : function(status,result){},
			handleTimerStatusUpdated : function(flowid){}
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
        wssocket = {},
		wsdsocket = {},
        connected = false;


    var ccclogic = function (settings, credentials, port, host) {
        return new CCCLogic(settings, credentials, port, host);
    };

    function CCCLogic(settings, credentials, _port, _host) {
		if (_port) {
			port = _port;
		}
		if (_host) {
			host = _host;
		}
		endpoint = "https://" + host + ":" + port;
		
		wsdendpoint = "wss://" + host + ":" + wsdport;

		//parse settings
		ccclogic.updateSettings(settings);

		createDiscoveryWSS();
	
    	if (settings && settings.validate && settings.callbacks) {
    		if (localStorage.cccusername && localStorage.cccsession) {
				this.login(localStorage.cccusername, null, localStorage.cccsession, false, true);
    		} else {
				flushLocalStorage();
				callbacks.handleValidateSession("error", {});
			}
    	} else if (credentials && credentials.username && credentials.password) {
			this.login(credentials.username, credentials.password, null, credentials.forced);
		} else if (localStorage.cccusername && localStorage.cccsession) {
			this.login(localStorage.cccusername, null, localStorage.cccsession);
		} else {
			flushLocalStorage();
			callbacks.handleLogout("error", {});
		}
    }

    //PRIVATE METHODS
    function createWSS(callback) {
        wssocket = WebSocket ? new WebSocket( wsendpoint ) : {
            send: function(m){ return false },
            close: function(){}
        };
        $(window).unload(function(){
			if(wssocket){
				wssocket.close();
				wssocket = null;
			}
		});
        $(wssocket)
        	.bind("open", function(){
        		var retrial = setInterval(function(){
        			if (connected) {
        				clearInterval(retrial);
        			} else {
        				if (wssocket && wssocket.readyState === 1) {
        					wssocket.send("CTI_APPLICATION_CONNECTED");
        				} else {
        					clearInterval(retrial);
        				}
        			}
        		}, 2000);
        	})
            .bind("message", function(e){
                try {
                	if (e.originalEvent.data === "CTI_APPLICATION_CONNECTED") {
                		connected = true;
                		if (typeof callback === "function") callback();
                	} else {
                		var m = JSON.parse(e.originalEvent.data);
	                    if (m.Sequence && m.Sequence > localStorage.cccsequence) {
	                    	localStorage.cccsequence = m.Sequence;
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
		                        } else if(m.Event === "RecordingStatusUpdated" && callbacks.handleFlowStatusChange) {
									callbacks.handleFlowStatusChange(m.Result.Id, m.Result.ProjectId, m.Result.Status);
								} else if (m.Event === "TransferStatusUpdated" && callbacks.handleTransfer) {
		                        	callbacks.handleTransfer(m.Result.Id, m.Result.Event);
		                        } else if (m.Event === "ResultCodeSuggested" && callbacks.handleResultCodeSuggestion) {
									callbacks.handleResultCodeSuggestion(m.Result.ResultCode, m.Result.Id);
								} else if ((m.Event === "TimerStarted" || m.Event === "TimerExpired") && callbacks.handleTimerStarted) {
									callbacks.handleTimerUpdated(m.Result.Id);
								}
		                    } else if(m.Entity === "System") {
								if(m.Event === "Exiting" && callbacks.handleLogout) {
									callbacks.handleLogout("success", m.Event);
								}
							}
	                	}
                	}
                } catch (error) { }
            });
    }
	
	function createDiscoveryWSS() {
		wsdsocket = WebSocket ? new WebSocket( wsdendpoint ) : {
			send: function(m){ return false },
			close: function(){}
		};
		$(window).unload(function(){
			if(wsdsocket){
				wsdsocket.close();
				wsdsocket = null;
			}
		});
		$(wsdsocket)
		.bind("message", function(e){
			try {
				var m = JSON.parse(e.originalEvent.data);
				if (m.Entity === "Logout" && 
						m.Result === "Exited" && 
						m.User.toUpperCase() === localStorage.cccusername.toUpperCase() &&
						m.SessionId === localStorage.cccsession) {
					flushLocalStorage();
					callbacks.handleLogout("success", {});
				} else if (m.Entity === "Crash"  &&
							m.Event === "Notification"  &&
						    m.User.toUpperCase() === localStorage.cccusername.toUpperCase() &&
							m.SessionId === localStorage.cccsession &&
							callbacks.handleCrash){
					callbacks.handleCrash("success", m.Event, m.ClientVersion);
				} else if (m.Entity === "Logout" && 
						m.Result === "AppExiting" && 
						m.User.toUpperCase() === localStorage.cccusername.toUpperCase() &&
						m.SessionId === localStorage.cccsession) {
					callbacks.handleLogout("success", "Exiting");
				}
			} catch (error) { }
		})
		.bind("error", function(e){
			//TODO..
		});
	}
	
    function refreshAgent() {
        return $.ajax({
            url : restendpoint + AGENT_CONTEXT,
            type : "GET",
            success : function(response, status, xhr) {
                if (response.Result && (typeof response.Result === "object")) {
                    $.extend(agent, response.Result);
                }
            },
			error : function(xhr, response, e) {
				callbacks.handleError(response, e);
           }
        });
    }

    function refreshProjects() {
        return $.ajax({
            url : restendpoint + PROJECT_CONTEXT,
            type : "GET",
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
				callbacks.handleError(response, e);
           }
        });
    }

    function refreshFlows() {
        return $.ajax({
            url : restendpoint + CALL_CONTEXT,
            type : "GET",
            success : function(response, status, xhr) {
                if (response.Result) {
                	if (response.Sequence) localStorage.cccsequence = response.Sequence;
                    if ($.isArray(response.Result)) {
                        $.each(response.Result, function(index, flow) {
                            activecall = flow.Id;
                            flows.push(flow);
                        });
                    }
                }
            },
			error : function(xhr, response, e) {
				callbacks.handleError(response, e);
           }
        });
    }

    function flowUrl(flowid) {
        return (flowid ? restendpoint + CALL_CONTEXT + "/" + flowid : restendpoint + CALL_CONTEXT + "/active");
    }
	
	function flushLocalStorage() {
		localStorage.removeItem("cccusername");
		localStorage.removeItem("cccsession");
		localStorage.removeItem("cccwsport");
		localStorage.removeItem("cccrestport");
		localStorage.removeItem("cccapiversion");
		localStorage.removeItem("cccsequence");
	}
	
	function handleLogin(status, validate, result) {
		if (validate) {
			callbacks.handleValidateSession(status, result);
		} else {
			callbacks.handleLogin(status, result);
		}
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
    	//  **forced**: If true, the user will be forced login, logging out other sessions
    	//  **validate**:If true, handleValidateSession will be called instead of handleLogin
        login : function(username, password, session, forced, validate) {
            $.ajax({
                url : endpoint + DISCOVERY_CONTEXT,
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
                        "Forced" : forced,
                        "Params" : ""
                    },
                    "DisconnectAfter" : 30000
                }),
                success : function(response, status, xhr) {
					if (response && response.Result && response.Result.UserName &&
							response.Result.UserName.toUpperCase() === username.toUpperCase() &&
							response.Result.LoginResult &&
							response.Result.LoginResult.Status) {
						if (response.Result.LoginResult.Status === "AppRunning") {
							localStorage.cccusername = response.Result.UserName;
							localStorage.cccrestport = response.Result.HttpPort;
							localStorage.cccwsport = response.Result.WebSocketPort;
							localStorage.cccapiversion = response.Result.ApiVersion;
							localStorage.cccsession = response.Result.LoginResult.SessionId;
							localStorage.cccsequence = 0;
							handleLogin("success", validate, response.Result);
						} else if (response.Result.LoginResult.Status === "AppNotInstalled") {
							handleLogin("error", validate, "AppNotInstalled");
						} else {
							flushLocalStorage();
							handleLogin("error", validate, {});
						}
					} else if(response.Error){
						flushLocalStorage();
   						handleLogin("error", validate, response.Error);
                    }
                },
				error : function(xhr, response, e) {
					if(xhr.responseJSON) {
						if (xhr.responseJSON && 
								xhr.responseJSON.Error && 
								(xhr.responseJSON.Error.Status === "LoginInvalidUserOrPassword" ||
									xhr.responseJSON.Error.Status === "AppExiting")) 
							flushLocalStorage();
							handleLogin("error", validate, xhr.responseJSON.Error);
					} else {
						handleLogin("error", validate, "NetworkError");
					}
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
                    if (response && response.Result) {
                    	restendpoint = "";
                        restport = 0;
                        wssocket.close(); wssocket = null;
						wsdsocket.close(); wsdsocket = null;
                        flushLocalStorage();
                        callbacks.handleLogout("success", response.Result);
                    } else if(response && response.Error){
						if(response.Error.Status === 'FinalizationPending') {
							callbacks.handleLogout("error", response.Error);
						} else {
							flushLocalStorage();
							callbacks.handleLogout("error", response);
						}
                    } else {
						flushLocalStorage();
                    	callbacks.handleLogout("error", {});
                    }
                },
				error : function(xhr, response, e) {
					flushLocalStorage();
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
        isChannelConnected : function() {
        	return connected;
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
                	if (response.Sequence) localStorage.cccsequence = response.Sequence;
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
                	if (response.Sequence) localStorage.cccsequence = response.Sequence;
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
                	if (response.Sequence) localStorage.cccsequence = response.Sequence;
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
        allocateAndDial : function(contactfields, dialpolicy, searchfields, allocationpolicy, callback) {
            $.ajax({
                url: restendpoint + PROJECT_CONTEXT + "/" + dialpolicy.ProjectId + "/calls",
                data: JSON.stringify({
                    "Command": "AllocateLeadAndPlaceCall",
                    "LeadRequest": {
                        "DialingDetails":[{
                            "Key": "dialphone",
                            "Value": dialpolicy.DialPhone
                        }],
                        "Fields": contactfields,
                        "SearchableFields": searchfields,
                        "Timeout": dialpolicy.Timeout,
                        "LeadAddActionType" : allocationpolicy.Action,
                        "IsForceAllocation" : allocationpolicy.Force,
                        "Callable" : allocationpolicy.Callable,
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
		changeRecordingStatus : function(flowid, pause) {
			$.ajax({
				 url: flowUrl(flowid),
                data: JSON.stringify({"Command" : (pause ? "PauseRecording" : "StartRecording")}),
				success : function(response, status, xhr) {
					if (typeof callback === "function") callback("success", response);
				},
				error : function(xhr, response, e) {
					if (typeof callback === "function") callback("error", response);
				}
			});
			// some dilemma about these recording status,
			// here implemented only two [startRecording, stopRecording/pauseRecourding]
			//"Command": "StartRecording/PauseRecording/ResumeRecording/StopRecording"
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
        finalize : function(flowid, resultcode, callback) {
            $.ajax({
                url : flowUrl(flowid),
                async : false,
                data : JSON.stringify({
                    "Command":"WrapUp",
                    "WrapUpParams":{
                        "Result" : resultcode
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
		updateCall : function(flowid, fields, callback) {
			$.ajax({
				url: flowUrl(flowid) + FIELDS_CONTEXT,
				data: JSON.stringify(fields),
				success : function(response, status, xhr) {
					if (typeof callback === "function") callback("success", response);
				},
				error : function(xhr, response, e) {
					if (typeof callback === "function") callback("error", response);
				}
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
                    "Uri" : number
                })
            });
        },
		init : function(callback) {
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
				createWSS(function(){
					$.when(
					refreshProjects(),
			        refreshAgent(),
			        refreshFlows()).done(function(){
			        	if (typeof callback === "function") callback();
			        });
				});
			} else {
				flushLocalStorage();
				callbacks.handleLogout("error", {});
			}
		},
		refreshing : function(){
			$.ajax({
                url : restendpoint + SYSTEM_CONTEXT + "/refreshing",
                async : false,
                type : "GET"
			});
		},
		credentials : function(){
			if (localStorage.cccusername) {
				return {
					session : localStorage.cccsession,
					username : localStorage.cccusername
				};
			}
			return {};
		},	
		reportError : function(message, clientversion){
		$.ajax({
                url : endpoint + DISCOVERY_SYSTEM_CONTEXT,
                data : JSON.stringify({
				"Message": message,
                "UserName" : username,
				"ClientVersion" : clientversion
                })
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
