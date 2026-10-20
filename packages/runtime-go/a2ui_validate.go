package runtime

// validateComponents matches toolkit structural/catalog checks; binding values stream later.
func validateComponents(components []any, schema map[string]any) []any {
	errors := []any{}
	add := func(code, path string) {
		errors = append(errors, map[string]any{"code": code, "path": path, "message": code})
	}
	if len(components) == 0 {
		add("empty_components", "components")
		return errors
	}
	if len(components) > 10000 {
		add("too_many_components", "components")
		return errors
	}
	catalog := object(schema["components"])
	ids := map[string]bool{}
	edges := map[string][]string{}
	for _, raw := range components {
		c := object(raw)
		id, kind := str(c["id"]), str(c["component"])
		if id == "" {
			add("missing_id", "components.id")
		}
		if kind == "" {
			add("missing_component_type", "components.component")
		}
		if ids[id] {
			add("duplicate_id", "components.id")
		}
		ids[id] = true
		definition := object(catalog[kind])
		if len(catalog) > 0 {
			if len(definition) == 0 {
				add("unknown_component", "components.component")
			} else {
				required, _ := definition["required"].([]any)
				for _, name := range required {
					if _, ok := c[str(name)]; !ok {
						add("missing_required_prop", "components."+str(name))
					}
				}
			}
		}
		refs := childRefs(c["child"])
		refs = append(refs, childRefs(c["children"])...)
		for field, rawProp := range object(definition["properties"]) {
			if field == "child" || field == "children" {
				continue
			}
			prop := object(rawProp)
			if prop["format"] == "componentRef" || prop["format"] == "componentRefList" {
				refs = append(refs, childRefs(c[field])...)
			} else if prop["type"] == "array" {
				items, _ := c[field].([]any)
				for _, item := range items {
					for sub, rawSub := range object(object(prop["items"])["properties"]) {
						subSchema := object(rawSub)
						if subSchema["format"] == "componentRef" || subSchema["format"] == "componentRefList" {
							refs = append(refs, childRefs(object(item)[sub])...)
						}
					}
				}
			}
		}
		edges[id] = refs
	}
	if !ids["root"] {
		add("no_root", "components")
	}
	for _, refs := range edges {
		for _, ref := range refs {
			if !ids[ref] {
				add("unresolved_child", "components")
			}
		}
	}
	type frame struct {
		id    string
		index int
	}
	colors := map[string]int{}
	for root := range edges {
		if colors[root] != 0 {
			continue
		}
		stack := []frame{{id: root}}
		colors[root] = 1
		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			refs := edges[top.id]
			if top.index >= len(refs) {
				colors[top.id] = 2
				stack = stack[:len(stack)-1]
				continue
			}
			child := refs[top.index]
			top.index++
			if colors[child] == 1 {
				add("child_cycle", "components")
				continue
			}
			if colors[child] == 0 {
				colors[child] = 1
				stack = append(stack, frame{id: child})
			}
		}
	}
	return errors
}
func childRefs(value any) []string {
	if s, ok := value.(string); ok {
		return []string{s}
	}
	if list, ok := value.([]any); ok {
		out := []string{}
		for _, v := range list {
			out = append(out, childRefs(v)...)
		}
		return out
	}
	if id := str(object(value)["componentId"]); id != "" {
		return []string{id}
	}
	return nil
}
