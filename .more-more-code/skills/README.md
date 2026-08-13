# Project Skills

Place project-specific skills in subdirectories using the shape:

```text
.more-more-code/skills/<skill-name>/SKILL.md
```

Each `SKILL.md` should start with frontmatter containing at least `name` and `description`. MORE-MORE-CODE discovers only this metadata during bootstrap; the complete skill body is loaded later through the native `loadSkill` tool when the workflow is relevant.
