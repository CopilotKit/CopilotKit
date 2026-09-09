:- begin_tests(ui_contracts).
:- use_module('../prolog/cpki_a2ui').
:- use_module('../prolog/cpki_mcp').

test(quoted_json_is_not_a_field, [fail]) :-
    json_field('{"text":"\\\"components\\\":[1]"}', "components", _).
test(incomplete_components_do_not_parse, [fail]) :-
    json_field('{"components":[{"id":"root"},', "components", _).
test(complete_field_in_partial_document) :-
    json_field('{"components":[{"id":"root"}],"data":', "components", [C]),
    assertion(C.id == "root").
test(partial_array_excludes_unfinished_item) :-
    partial_array('{"data":{"items":[{"name":"one"},{"name":', items, Items),
    assertion(Items = [_{name:"one"}]).
test(catalog_reference_cycle) :-
    Config=_{schema:_{components:_{'Panel':_{properties:_{body:_{format:"componentRef"}}}}}},
    validate_components(Config,[_{id:"root",component:"Panel",body:"root"}],Errors),
    assertion(member(_{code:"child_cycle",message:"child_cycle",path:"components"},Errors)).
test(mcp_rejects_untrusted_server_without_transport) :-
    mcp_proxy([_{serverId:"trusted",type:"http",url:"http://127.0.0.1:1"}],
      _{serverId:"other",method:"resources/read"},Result),assertion(get_dict(error,Result,_)).
test(mcp_duplicate_tools_throw, [throws(error(runtime(502,_),_))]) :-
    cpki_mcp:unique_tools(["same"-_{},"same"-_{}]).
test(completed_outer_tool_does_not_own_later_surface) :-
    a2ui_prepare(_{},_{},_,State),
    a2ui_accept(State,_{type:"TOOL_CALL_START",toolCallId:"outer",toolCallName:"other"},ignore_event),
    a2ui_accept(State,_{type:"TOOL_CALL_RESULT",toolCallId:"outer",content:"done"},ignore_event),
    a2ui_accept(State,_{type:"TOOL_CALL_START",toolCallId:"later",toolCallName:"render_a2ui"},assert_later_surface).
ignore_event(_).
assert_later_surface(Event) :- assertion(Event.messageId=="a2ui-surface-later").
test(mcp_hash_uses_canonical_json_without_writer_whitespace) :-
    server_hash(_{type:"http",url:"http://localhost/mcp"},Hash),
    assertion(Hash=="b686603fe454775ec3a87896f67f5b14").
:- end_tests(ui_contracts).
