# Hook Development

When creating a new hook, always complete **all** of the following:

1. **Implementation**: Create the hook in the V2 react package. If V1 compatibility is needed, add a re-export in the V1 react-core package.
2. **JSDoc**: Add JSDoc on top of the hook implementation, including usage examples.
3. **Tests**: Write extensive tests covering behavior, edge cases, and lifecycle (mount/unmount/re-render).
4. **Documentation**: Add a dedicated docs page under `/docs` and update the relevant docs metadata file(s) so the page appears in navigation.
