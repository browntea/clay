# Clay TODO

1. ~~Permission mode 선택 기능 추가~~ ✅
2. Skills 툴 추가
3. 챗 검색기능 추가
4. 프로젝트 설정 기능 추가 (환경변수 설정)
5. 검색기능 오류 픽스 (숫자 안맞는 문제)
6. 터널링 붙이기 (https://www.npmjs.com/package/untun)
7. 보안체크
8. RBAC
9. 프레전스
10. 리팩토링

---

# SDK 0.2.38 → 0.2.63 변경 과제

SDK 업그레이드(0.2.38 → 0.2.63)에서 새로 사용 가능한 기능들.
추천 구현 순서: Rate Limit → Prompt Suggestions → FastModeState → Effort Config + ModelInfo → Local Command Output → Task Progress → listSessions/getSessionMessages

---

## HIGH — 바로 적용하면 좋은 것들

### 1. Rate Limit Events
- **메시지**: `rate_limit_event`
- **설명**: 한도 초과 시 사용자에게 경고/차단 배너 표시. 현재는 rate limit 걸리면 조용히 실패함
- **예상 작업량**: 2-3시간
- [x] 완료

### 2. Prompt Suggestions
- **옵션**: `promptSuggestions: true`
- **메시지**: `prompt_suggestion`
- **설명**: 턴 끝나면 추천 프롬프트 칩 표시. prompt cache 활용이라 거의 무료
- **예상 작업량**: 3-4시간
- [x] 완료

### 3. FastModeState
- **필드**: `fast_mode_state: 'off'|'cooldown'|'on'`
- **설명**: rate limit 시 자동으로 fast mode 전환되는데 사용자가 모름. 상태 표시 필요
- **예상 작업량**: 1-2시간
- [x] 완료

### 4. Task Progress (향상)
- **메시지**: `task_started` / `task_progress`
- **설명**: sub-agent 진행률을 token 사용량, 마지막 도구명까지 정확히 추적 + `stopTask()`
- **예상 작업량**: 3-4시간
- [x] 완료

### 5. Thinking/Effort Config
- **옵션**: `effort: 'low'|'medium'|'high'|'max'`
- **설명**: ThinkingConfig — 비용/속도 조절 레버. UI에 effort 선택기 추가
- **예상 작업량**: 3-4시간
- [x] 완료 (config chip에 effort 선택기 포함)

### 6. ModelInfo effort fields
- **필드**: `supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`
- **설명**: effort 선택기의 모델별 조건 표시
- **예상 작업량**: 30분
- [x] 완료 (모델별 effort 레벨 반영)

---

## MEDIUM — 코드 품질/확장성

### 7. listSessions() / getSessionMessages()
- **설명**: SDK 공식 API로 `cli-sessions.js`의 수동 JSONL 파싱 대체. 향후 SDK 포맷 변경에 안전
- **예상 작업량**: 2-3시간
- [ ] 미완료

### 8. MCP Elicitation
- **콜백**: `onElicitation`
- **설명**: MCP 서버 OAuth 인증/폼 입력 지원. MCP 생태계 확장에 필수
- **예상 작업량**: 4-6시간
- [ ] 미완료

### 9. Local Command Output
- **메시지**: `local_command_output`
- **설명**: 현재 XML 태그 파싱 해킹(`<local-command-stdout>`)을 공식 메시지로 대체
- **예상 작업량**: 30분
- [ ] 미완료

### 10. PromptRequest/Response
- **설명**: SDK가 구조화된 선택지를 요청하는 새 메시지 타입
- **예상 작업량**: 2-3시간
- [ ] 미완료

### 11. forkSession
- **옵션**: `resume` + `forkSession: true`
- **설명**: 대화 분기 기능. 기존 rewind와 조합 가능
- **예상 작업량**: 2-3시간
- [ ] 미완료

---

## LOW — 나중에 해도 됨

### 12. Compact Boundary 메타데이터
- **설명**: 압축 전 토큰 수 표시
- [ ] 미완료

### 13. Auth Status
- **설명**: MCP 인증 진행 표시
- [ ] 미완료

### 14. Tool Use Summary
- **설명**: SDK 생성 도구 요약
- [ ] 미완료

### 15. Sandbox Config
- **설명**: 보안 설정 (공개 배포 시)
- [ ] 미완료

### 16. V2 API (`unstable_v2_*`)
- **설명**: 아직 알파, 안정화 후 마이그레이션
- [ ] 미완료

### 17. `betas: ['context-1m-*']`
- **설명**: Sonnet 전용 1M 컨텍스트
- [ ] 미완료

### 18. `persistSession: false`
- **설명**: 임시 세션
- [ ] 미완료

---

## 이미 처리됨

- [x] **`setPermissionMode()`** — 구현 완료
- [x] **Model name 변경** (claude-sonnet-4-6 등) — 동적 모델 목록이라 자동 반영
- [x] **`delegate` PermissionMode 삭제** — 사용 안 하고 있었음
