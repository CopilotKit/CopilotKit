# HWP 파일 통합 매크로 개발 가이드라인

## 1. 프로젝트 개요

### 1.1 목적
지정한 폴더 내의 여러 한글(HWP) 파일을 사용자가 지정한 순서대로 하나의 파일로 통합하는 Excel VBA 매크로

### 1.2 핵심 워크플로우
```
[목록 가져오기] → 사용자 순번 입력 → [통합 실행] → 결과 확인
        ↓
   [목록 초기화] (필요시)
```

### 1.3 설계 원칙
- 원본 파일 서식 100% 유지 (구역 나누기 적용)
- 실패 시에도 나머지 파일 계속 처리 (Graceful Degradation)
- 모든 처리 상태를 시트에 실시간 기록 (모니터링 가능)

---

## 2. 기술 요구사항

### 2.1 실행 환경
- Microsoft Excel 2010 이상
- 한컴오피스 한글 2010 이상 (OLE Automation 지원 버전)
- Windows 환경 (한글 OLE는 Windows 전용)

### 2.2 사용 기술
- Excel VBA
- 한글 OLE Automation (`HWPFrame.HwpObject`)
- FileSystemObject (파일 탐색)
- Application.FileDialog (폴더 선택)

### 2.3 참조 설정 (VBA Editor → 도구 → 참조)
```
✓ Microsoft Scripting Runtime (FileSystemObject용)
```
> 한글 OLE는 Late Binding 사용 (CreateObject) - 별도 참조 불필요

---

## 3. UI 설계

### 3.1 시트 구조 ("제어판" 시트)

#### 헤더 행 (Row 1)
| 열 | 헤더명 | 너비 | 용도 |
|---|--------|------|------|
| A | 파일명 | 40 | HWP 파일명 표시 |
| B | 통합순번 | 12 | 사용자 입력 (숫자) |
| C | 상태 | 15 | 처리 결과 표시 |
| D | 비고 | 30 | 에러 메시지 등 |
| E | 전체경로 | 60 | 파일 절대 경로 (표시) |

#### 데이터 영역
- Row 2부터 파일 목록 시작
- 파일 수만큼 동적으로 행 생성

### 3.2 버튼 배치 (권장 위치)
| 버튼 | 위치 | 크기(W×H) | 연결 매크로 |
|------|------|-----------|-------------|
| [1. 목록 가져오기] | G2:H3 | 120×40 | `Sub GetFileList()` |
| [2. 통합 실행] | G5:H6 | 120×40 | `Sub MergeFiles()` |
| [3. 목록 초기화] | G8:H9 | 120×40 | `Sub ClearList()` |

### 3.3 상태 표시 규칙
| 상태 값 | 의미 | 셀 배경색 (권장) |
|---------|------|------------------|
| (빈칸) | 대기 중 | 없음 |
| ✓ 완료 | 통합 성공 | 연한 녹색 (#C6EFCE) |
| ✗ 실패 | 통합 실패 | 연한 빨강 (#FFC7CE) |
| - 제외 | 순번 미입력으로 제외 | 연한 회색 (#D9D9D9) |
| ⏳ 처리중 | 현재 처리 중 | 연한 노랑 (#FFEB9C) |

---

## 4. 데이터 구조

### 4.1 모듈 수준 변수
```vba
Private mFolderPath As String       ' 선택된 폴더 경로
Private mFileCount As Integer       ' 목록의 파일 수
Private Const SHEET_NAME = "제어판"  ' 작업 시트명
Private Const DATA_START_ROW = 2    ' 데이터 시작 행
```

### 4.2 파일 정보 구조 (정렬용)
```vba
Type FileInfo
    FileName As String      ' 파일명
    FullPath As String      ' 전체 경로
    SortOrder As Integer    ' 통합 순번
    RowIndex As Integer     ' 시트상 행 번호 (상태 업데이트용)
End Type
```

---

## 5. 기능별 상세 로직

### 5.1 [목록 가져오기] - GetFileList()

#### 처리 흐름
```
1. 폴더 선택 다이얼로그 표시
2. 선택 취소 시 → 종료
3. 기존 데이터 존재 시 → 확인 메시지 ("기존 목록을 덮어쓰시겠습니까?")
4. 시트 초기화 (헤더 제외)
5. 폴더 내 *.hwp 파일 탐색
6. 파일별로 시트에 행 추가
   - A열: 파일명
   - B열: (빈칸) - 사용자 입력 대기
   - C열: (빈칸)
   - D열: (빈칸)
   - E열: 전체 경로
7. 폴더 경로를 모듈 변수에 저장
8. 완료 메시지 표시 ("N개 파일을 찾았습니다")
```

#### 폴더 선택 코드 패턴
```vba
With Application.FileDialog(msoFileDialogFolderPicker)
    .Title = "HWP 파일이 있는 폴더를 선택하세요"
    .AllowMultiSelect = False
    If .Show = -1 Then
        mFolderPath = .SelectedItems(1)
    Else
        Exit Sub  ' 취소됨
    End If
End With
```

#### HWP 파일 탐색 패턴
```vba
Dim fso As Object, folder As Object, file As Object
Set fso = CreateObject("Scripting.FileSystemObject")
Set folder = fso.GetFolder(mFolderPath)

For Each file In folder.Files
    If LCase(fso.GetExtensionName(file.Name)) = "hwp" Then
        ' 시트에 추가
    End If
Next
```

---

### 5.2 [통합 실행] - MergeFiles()

#### 처리 흐름
```
1. 사전 검증
   a. 목록이 비어있는지 확인 → 비어있으면 "먼저 목록을 가져오세요" 후 종료
   b. 순번 입력된 파일이 하나도 없는지 확인 → 없으면 경고 후 종료
   c. 순번 중복 확인 → 중복 시 "순번 N이 중복됩니다" 후 종료

2. 통합 파일명 결정
   a. "통합파일.hwp" 존재 여부 확인
   b. 존재하면 "통합파일2.hwp", "통합파일3.hwp"... 순차 탐색
   c. 사용 가능한 파일명 확정

3. 파일 정보 배열 구성
   a. 순번이 입력된 파일만 배열에 추가
   b. 순번 미입력 파일은 상태를 "- 제외"로 업데이트
   c. 배열을 순번 기준 오름차순 정렬

4. 한글 객체 초기화
   a. CreateObject("HWPFrame.HwpObject")
   b. hwp.XHwpWindows.Item(0).Visible = True (창 표시 - 필수)
   c. 보안 모듈 등록 (필요시)

5. 빈 문서 생성
   a. hwp.HAction.Run "FileNew"

6. 순차 파일 삽입 (Loop)
   For Each fileInfo In sortedArray
       a. 상태를 "⏳ 처리중"으로 업데이트
       b. On Error Resume Next
       c. InsertFile 실행 (구역 나누기 옵션)
       d. 에러 확인
          - 성공: 상태 "✓ 완료"
          - 실패: 상태 "✗ 실패", 비고에 에러 메시지
       e. On Error GoTo 0
       f. DoEvents (화면 갱신)
   Next

7. 통합 파일 저장
   a. hwp.SaveAs mFolderPath & "\" & 결정된파일명, "HWP"
   b. 저장 실패 시 에러 처리

8. 정리
   a. hwp.Quit
   b. Set hwp = Nothing
   c. 완료 메시지 ("통합 완료: N개 성공, M개 실패")
```

#### 순번 중복 검증 로직
```vba
Function HasDuplicateOrder() As String
    ' 반환: 빈 문자열이면 중복 없음, 아니면 중복된 순번
    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    Dim ws As Worksheet, i As Integer, orderNum As Variant
    Set ws = ThisWorkbook.Sheets(SHEET_NAME)

    For i = DATA_START_ROW To GetLastRow()
        orderNum = ws.Cells(i, 2).Value  ' B열
        If orderNum <> "" And IsNumeric(orderNum) Then
            If dict.Exists(CStr(orderNum)) Then
                HasDuplicateOrder = CStr(orderNum)
                Exit Function
            End If
            dict.Add CStr(orderNum), True
        End If
    Next
    HasDuplicateOrder = ""
End Function
```

#### 파일명 중복 방지 로직
```vba
Function GetUniqueFileName() As String
    Dim baseName As String, testPath As String
    Dim counter As Integer
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")

    baseName = "통합파일"
    testPath = mFolderPath & "\" & baseName & ".hwp"

    If Not fso.FileExists(testPath) Then
        GetUniqueFileName = baseName & ".hwp"
        Exit Function
    End If

    counter = 2
    Do
        testPath = mFolderPath & "\" & baseName & counter & ".hwp"
        If Not fso.FileExists(testPath) Then
            GetUniqueFileName = baseName & counter & ".hwp"
            Exit Function
        End If
        counter = counter + 1
    Loop While counter < 1000  ' 무한루프 방지
End Function
```

#### 핵심: InsertFile API 호출
```vba
' 구역 나누기로 파일 삽입 (원본 서식 유지)
Sub InsertHwpFile(hwp As Object, filePath As String)
    hwp.HAction.GetDefault "InsertFile", hwp.HParameterSet.HInsertFile.HSet
    With hwp.HParameterSet.HInsertFile
        .filename = filePath
        .KeepSection = True      ' ★ 구역 유지 (서식 독립)
        .KeepCharshape = True    ' 글자 모양 유지
        .KeepParashape = True    ' 문단 모양 유지
        .KeepStyle = True        ' 스타일 유지
    End With
    hwp.HAction.Execute "InsertFile", hwp.HParameterSet.HInsertFile.HSet
End Sub
```

---

### 5.3 [목록 초기화] - ClearList()

#### 처리 흐름
```
1. 확인 메시지 ("목록을 초기화하시겠습니까?")
2. "예" 선택 시:
   a. 데이터 영역 전체 삭제 (Row 2 ~ 마지막)
   b. 모듈 변수 초기화 (mFolderPath = "", mFileCount = 0)
   c. 완료 메시지
3. "아니오" 선택 시: 종료
```

---

## 6. 에러 처리 전략

### 6.1 에러 수준 분류
| 수준 | 상황 | 처리 |
|------|------|------|
| Critical | 한글 객체 생성 실패 | 전체 중단 + 메시지 |
| Critical | 저장 경로 접근 불가 | 전체 중단 + 메시지 |
| File-level | 개별 파일 열기 실패 | 해당 파일 스킵 + 상태 기록 |
| File-level | 파일 손상 | 해당 파일 스킵 + 상태 기록 |
| Warning | 순번 중복 | 실행 전 차단 + 메시지 |

### 6.2 에러 메시지 템플릿
```vba
' Critical 에러
MsgBox "한글 프로그램을 찾을 수 없습니다." & vbCrLf & _
       "한컴오피스가 설치되어 있는지 확인하세요.", _
       vbCritical, "오류"

' 파일 레벨 에러 (비고 열에 기록)
ws.Cells(rowIdx, 4).Value = "파일 열기 실패: " & Err.Description

' 완료 메시지
MsgBox "통합 완료" & vbCrLf & _
       "성공: " & successCount & "개" & vbCrLf & _
       "실패: " & failCount & "개" & vbCrLf & _
       "제외: " & skipCount & "개" & vbCrLf & vbCrLf & _
       "저장 위치: " & savedPath, _
       vbInformation, "완료"
```

---

## 7. 유틸리티 함수

### 7.1 마지막 행 찾기
```vba
Function GetLastRow() As Long
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(SHEET_NAME)
    GetLastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
End Function
```

### 7.2 상태 셀 업데이트 (색상 포함)
```vba
Sub UpdateStatus(rowIdx As Integer, status As String, Optional note As String = "")
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(SHEET_NAME)

    ws.Cells(rowIdx, 3).Value = status
    ws.Cells(rowIdx, 4).Value = note

    Select Case status
        Case "✓ 완료"
            ws.Cells(rowIdx, 3).Interior.Color = RGB(198, 239, 206)
        Case "✗ 실패"
            ws.Cells(rowIdx, 3).Interior.Color = RGB(255, 199, 206)
        Case "- 제외"
            ws.Cells(rowIdx, 3).Interior.Color = RGB(217, 217, 217)
        Case "⏳ 처리중"
            ws.Cells(rowIdx, 3).Interior.Color = RGB(255, 235, 156)
        Case Else
            ws.Cells(rowIdx, 3).Interior.ColorIndex = xlNone
    End Select

    DoEvents  ' 화면 즉시 갱신
End Sub
```

### 7.3 배열 정렬 (순번 기준)
```vba
' Bubble Sort (파일 수 20개 이하이므로 충분)
Sub SortFileArray(arr() As FileInfo)
    Dim i As Integer, j As Integer
    Dim temp As FileInfo

    For i = LBound(arr) To UBound(arr) - 1
        For j = i + 1 To UBound(arr)
            If arr(i).SortOrder > arr(j).SortOrder Then
                temp = arr(i)
                arr(i) = arr(j)
                arr(j) = temp
            End If
        Next j
    Next i
End Sub
```

---

## 8. 모듈 구조

```
ThisWorkbook
  └─ (이벤트 코드 없음)

Module1 (Main)
  ├─ Public Sub GetFileList()      ' 버튼1: 목록 가져오기
  ├─ Public Sub MergeFiles()       ' 버튼2: 통합 실행
  ├─ Public Sub ClearList()        ' 버튼3: 목록 초기화
  ├─ Private Function HasDuplicateOrder() As String
  ├─ Private Function GetUniqueFileName() As String
  ├─ Private Function GetLastRow() As Long
  ├─ Private Sub UpdateStatus(...)
  ├─ Private Sub SortFileArray(...)
  ├─ Private Sub InsertHwpFile(...)
  └─ Private Sub InitializeSheet()  ' 헤더 설정 (최초 1회)
```

---

## 9. 테스트 시나리오

### 9.1 정상 케이스
| # | 시나리오 | 예상 결과 |
|---|----------|-----------|
| 1 | 5개 파일, 순번 1-5 입력, 통합 실행 | 5개 모두 성공, 통합파일.hwp 생성 |
| 2 | 10개 파일, 3개만 순번 입력 | 3개 성공, 7개 "- 제외" |
| 3 | 순번 1, 3, 5 (중간 누락) | 1→3→5 순서로 정상 통합 |

### 9.2 예외 케이스
| # | 시나리오 | 예상 결과 |
|---|----------|-----------|
| 4 | 순번 중복 (1, 1, 2) | 실행 전 차단, "순번 1이 중복됩니다" |
| 5 | 빈 폴더 선택 | "HWP 파일이 없습니다" |
| 6 | 손상된 파일 포함 | 해당 파일만 실패, 나머지 계속 |
| 7 | 통합파일.hwp 이미 존재 | 통합파일2.hwp로 저장 |
| 8 | 목록 없이 통합 실행 클릭 | "먼저 목록을 가져오세요" |

### 9.3 경계 케이스
| # | 시나리오 | 예상 결과 |
|---|----------|-----------|
| 9 | 파일 1개만 통합 | 정상 동작 (의미는 없지만 에러 없음) |
| 10 | 순번에 문자 입력 ("a") | 해당 파일 "- 제외" 처리 |
| 11 | 순번에 음수 입력 (-1) | 정상 정렬에 포함 (음수도 유효한 순번) |

---

## 10. 코딩 시 주의사항

### 10.1 한글 OLE 관련
```vba
' ❌ 잘못된 방식 - 에러 발생 가능
Set hwp = CreateObject("Hwp.HwpObject")

' ✅ 올바른 방식
Set hwp = CreateObject("HWPFrame.HwpObject")
```

### 10.2 한글 창 표시 (필수)
```vba
' 통합 중 한글 창을 반드시 표시
hwp.XHwpWindows.Item(0).Visible = True
```

### 10.3 화면 갱신
```vba
' 상태 업데이트 후 반드시 호출
DoEvents

' 대량 처리 시 화면 갱신 일시 중지 (속도 향상)
Application.ScreenUpdating = False
' ... 처리 ...
Application.ScreenUpdating = True
```

### 10.4 객체 해제
```vba
' 반드시 역순으로 해제
hwp.Quit
Set hwp = Nothing
Set fso = Nothing
```

### 10.5 경로 처리
```vba
' 폴더 경로 끝의 \ 처리
If Right(mFolderPath, 1) <> "\" Then
    mFolderPath = mFolderPath & "\"
End If
```

---

## 11. 향후 확장 고려사항 (Optional)

현재 범위에서 제외하되, 추후 추가 가능한 기능:
- **진행률 표시**: StatusBar 또는 ProgressBar
- **PDF 동시 출력**: 통합 후 PDF 자동 변환
- **미리보기**: 순번대로 파일명 미리보기
- **설정 저장**: 마지막 사용 폴더 기억
- **로그 파일**: 처리 이력 txt 저장

---

## 12. 체크리스트 (개발 완료 전 확인)

- [ ] 버튼 3개 정상 동작
- [ ] 폴더 선택 다이얼로그 정상
- [ ] HWP 파일만 필터링됨
- [ ] 순번 정렬 정상
- [ ] 순번 중복 검증 정상
- [ ] 구역 나누기로 서식 유지됨
- [ ] 실패 파일 상태 기록됨
- [ ] 통합파일 중복 방지 동작
- [ ] 목록 초기화 정상
- [ ] 에러 메시지 명확함
- [ ] 한글 창 표시됨 (Visible = True)

---

**문서 버전**: 1.0
**작성일**: 2025-01-XX
