:- begin_tests(inspector_contracts).
:- use_module('../prolog/cpki_inspector').

test(unknown_version_has_no_metadata,[fail]) :- inspector_metadata(_{schemaVersion:2},_).
test(sanitizes_independent_modules) :-
    inspector_metadata(_{schemaVersion:1,secret:"hidden",
      identity:_{organizationName:" Org ",projectName:" Project ",secret:"hidden"},
      plan:_{code:"team",label:"Team"},license:_{state:"valid"},
      usage:_{used:3,limit:_{kind:"finite",value:10},expiringSoonCount:1}},R),
    assertion(R.identity = _{organizationName:"Org",projectName:"Project"}),
    assertion(\+get_dict(secret,R,_)),assertion(R.usage.used==3).
test(rejects_url_credentials_queries_and_fragments) :-
    forall(member(URL,["https://user:pass@example.com","https://example.com?secret=x","https://example.com#token","javascript:alert(1)","http://example.com"]),
      (inspector_metadata(_{schemaVersion:1,action:_{kind:"renew",url:URL}},R),assertion(\+get_dict(action,R,_)))).
test(accepts_https_and_loopback_http) :-
    forall(member(URL,["https://example.com/plan","http://localhost:4000/plan","http://127.0.0.1/plan","http://[::1]/plan"]),
      (inspector_metadata(_{schemaVersion:1,action:_{kind:"renew",url:URL}},R),assertion(R.action.url==URL))).
test(usage_rejects_unsafe_integers) :-
    inspector_metadata(_{schemaVersion:1,usage:_{used:9007199254740992,limit:_{kind:"unlimited"}}},R),
    assertion(\+get_dict(usage,R,_)).
:- end_tests(inspector_contracts).
