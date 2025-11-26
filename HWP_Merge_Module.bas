Attribute VB_Name = "HWP_Merge"
'===============================================================================
' HWP 파일 통합 매크로
' 버전: 1.0
' 설명: 지정한 폴더 내의 HWP 파일을 사용자 순번대로 통합
'===============================================================================

Option Explicit

'-------------------------------------------------------------------------------
' 모듈 수준 상수 및 변수
'-------------------------------------------------------------------------------
Private Const SHEET_NAME As String = "제어판"
Private Const DATA_START_ROW As Integer = 2

Private mFolderPath As String
Private mFileCount As Integer

'-------------------------------------------------------------------------------
' 파일 정보 구조체 (정렬용)
'-------------------------------------------------------------------------------
Private Type FileInfo
    FileName As String
    FullPath As String
    SortOrder As Integer
    RowIndex As Integer
End Type

'===============================================================================
' [버튼1] 목록 가져오기
'===============================================================================
Public Sub GetFileList()
    Dim ws As Worksheet
    Dim fso As Object
    Dim folder As Object
    Dim file As Object
    Dim rowIdx As Integer
    Dim fileCount As Integer

    ' 시트 확인/생성
    If Not SheetExists(SHEET_NAME) Then
        Call InitializeSheet
    End If
    Set ws = ThisWorkbook.Sheets(SHEET_NAME)

    ' 폴더 선택 다이얼로그
    With Application.FileDialog(msoFileDialogFolderPicker)
        .Title = "HWP 파일이 있는 폴더를 선택하세요"
        .AllowMultiSelect = False
        If .Show = -1 Then
            mFolderPath = .SelectedItems(1)
        Else
            Exit Sub  ' 취소됨
        End If
    End With

    ' 경로 끝 처리
    If Right(mFolderPath, 1) <> "\" Then
        mFolderPath = mFolderPath & "\"
    End If

    ' 기존 데이터 확인
    If GetLastRow() >= DATA_START_ROW Then
        If MsgBox("기존 목록을 덮어쓰시겠습니까?", vbYesNo + vbQuestion, "확인") = vbNo Then
            Exit Sub
        End If
        ' 기존 데이터 삭제
        ws.Rows(DATA_START_ROW & ":" & GetLastRow()).Delete
    End If

    ' 파일 탐색
    Set fso = CreateObject("Scripting.FileSystemObject")

    If Not fso.FolderExists(mFolderPath) Then
        MsgBox "폴더를 찾을 수 없습니다.", vbCritical, "오류"
        Exit Sub
    End If

    Set folder = fso.GetFolder(mFolderPath)

    rowIdx = DATA_START_ROW
    fileCount = 0

    For Each file In folder.Files
        If LCase(fso.GetExtensionName(file.Name)) = "hwp" Then
            ws.Cells(rowIdx, 1).Value = file.Name           ' A열: 파일명
            ws.Cells(rowIdx, 2).Value = ""                  ' B열: 통합순번 (사용자 입력)
            ws.Cells(rowIdx, 3).Value = ""                  ' C열: 상태
            ws.Cells(rowIdx, 4).Value = ""                  ' D열: 비고
            ws.Cells(rowIdx, 5).Value = file.Path           ' E열: 전체경로
            rowIdx = rowIdx + 1
            fileCount = fileCount + 1
        End If
    Next file

    mFileCount = fileCount

    ' 정리
    Set file = Nothing
    Set folder = Nothing
    Set fso = Nothing

    ' 결과 메시지
    If fileCount = 0 Then
        MsgBox "해당 폴더에 HWP 파일이 없습니다.", vbInformation, "알림"
    Else
        MsgBox fileCount & "개의 HWP 파일을 찾았습니다." & vbCrLf & _
               "통합순번(B열)에 순서를 입력한 후 [통합 실행] 버튼을 누르세요.", _
               vbInformation, "완료"
    End If
End Sub

'===============================================================================
' [버튼2] 통합 실행
'===============================================================================
Public Sub MergeFiles()
    Dim ws As Worksheet
    Dim hwp As Object
    Dim fso As Object
    Dim lastRow As Long
    Dim i As Integer
    Dim fileCount As Integer
    Dim validCount As Integer
    Dim successCount As Integer
    Dim failCount As Integer
    Dim skipCount As Integer
    Dim dupCheck As String
    Dim outputFileName As String
    Dim outputPath As String
    Dim files() As FileInfo
    Dim orderNum As Variant

    ' 시트 확인
    If Not SheetExists(SHEET_NAME) Then
        MsgBox "먼저 [목록 가져오기]를 실행하세요.", vbExclamation, "알림"
        Exit Sub
    End If
    Set ws = ThisWorkbook.Sheets(SHEET_NAME)

    lastRow = GetLastRow()

    ' 1. 목록 비어있는지 확인
    If lastRow < DATA_START_ROW Then
        MsgBox "먼저 [목록 가져오기]를 실행하세요.", vbExclamation, "알림"
        Exit Sub
    End If

    ' 폴더 경로 확인 (모듈 변수가 비어있으면 E열에서 추출)
    If mFolderPath = "" Then
        mFolderPath = GetFolderFromPath(ws.Cells(DATA_START_ROW, 5).Value)
    End If

    ' 2. 순번 입력된 파일 확인
    validCount = 0
    For i = DATA_START_ROW To lastRow
        orderNum = ws.Cells(i, 2).Value
        If orderNum <> "" And IsNumeric(orderNum) Then
            validCount = validCount + 1
        End If
    Next i

    If validCount = 0 Then
        MsgBox "통합할 파일의 순번을 입력하세요." & vbCrLf & _
               "(B열에 1, 2, 3... 형태로 입력)", vbExclamation, "알림"
        Exit Sub
    End If

    ' 3. 순번 중복 확인
    dupCheck = HasDuplicateOrder()
    If dupCheck <> "" Then
        MsgBox "순번 " & dupCheck & "이(가) 중복됩니다." & vbCrLf & _
               "중복된 순번을 수정해주세요.", vbExclamation, "순번 중복"
        Exit Sub
    End If

    ' 4. 통합 파일명 결정
    outputFileName = GetUniqueFileName()
    outputPath = mFolderPath & outputFileName

    ' 5. 파일 정보 배열 구성
    ReDim files(1 To validCount)
    Dim arrIdx As Integer
    arrIdx = 0

    For i = DATA_START_ROW To lastRow
        orderNum = ws.Cells(i, 2).Value
        If orderNum <> "" And IsNumeric(orderNum) Then
            arrIdx = arrIdx + 1
            files(arrIdx).FileName = ws.Cells(i, 1).Value
            files(arrIdx).FullPath = ws.Cells(i, 5).Value
            files(arrIdx).SortOrder = CInt(orderNum)
            files(arrIdx).RowIndex = i
        Else
            ' 순번 미입력 → 제외 처리
            Call UpdateStatus(i, "- 제외", "순번 미입력")
            skipCount = skipCount + 1
        End If
    Next i

    ' 6. 순번 기준 정렬
    Call SortFileArray(files)

    ' 7. 한글 객체 초기화
    On Error Resume Next
    Set hwp = CreateObject("HWPFrame.HwpObject")
    If Err.Number <> 0 Then
        MsgBox "한글 프로그램을 찾을 수 없습니다." & vbCrLf & _
               "한컴오피스가 설치되어 있는지 확인하세요.", vbCritical, "오류"
        Exit Sub
    End If
    On Error GoTo 0

    ' 한글 창 표시 (필수)
    hwp.XHwpWindows.Item(0).Visible = True

    ' 보안 모듈 등록 (일부 버전에서 필요)
    On Error Resume Next
    hwp.RegisterModule "FilePathCheckDLL", "FilePathCheckerModule"
    On Error GoTo 0

    ' 8. 새 문서 생성
    hwp.HAction.Run "FileNew"

    ' 9. 파일 순차 삽입
    Set fso = CreateObject("Scripting.FileSystemObject")
    successCount = 0
    failCount = 0

    For i = 1 To validCount
        ' 상태 업데이트: 처리중
        Call UpdateStatus(files(i).RowIndex, "⏳ 처리중", "")
        DoEvents

        ' 파일 존재 확인
        If Not fso.FileExists(files(i).FullPath) Then
            Call UpdateStatus(files(i).RowIndex, "✗ 실패", "파일을 찾을 수 없음")
            failCount = failCount + 1
            GoTo NextFile
        End If

        ' 첫 번째 파일이 아니면 구역 나누기 삽입
        If i > 1 Then
            hwp.HAction.Run "BreakSection"
        End If

        ' InsertFile 실행
        On Error Resume Next
        Err.Clear

        hwp.HAction.GetDefault "InsertFile", hwp.HParameterSet.HInsertFile.HSet
        With hwp.HParameterSet.HInsertFile
            .filename = files(i).FullPath
            .KeepSection = True
            .KeepCharshape = True
            .KeepParashape = True
            .KeepStyle = True
        End With
        hwp.HAction.Execute "InsertFile", hwp.HParameterSet.HInsertFile.HSet

        If Err.Number <> 0 Then
            Call UpdateStatus(files(i).RowIndex, "✗ 실패", "삽입 오류: " & Err.Description)
            failCount = failCount + 1
            Err.Clear
        Else
            Call UpdateStatus(files(i).RowIndex, "✓ 완료", "")
            successCount = successCount + 1
        End If
        On Error GoTo 0

NextFile:
        DoEvents
    Next i

    ' 10. 파일 저장
    On Error Resume Next
    hwp.SaveAs outputPath, "HWP"
    If Err.Number <> 0 Then
        MsgBox "파일 저장에 실패했습니다." & vbCrLf & Err.Description, vbCritical, "저장 오류"
        hwp.Quit
        Set hwp = Nothing
        Set fso = Nothing
        Exit Sub
    End If
    On Error GoTo 0

    ' 11. 정리
    hwp.Quit
    Set hwp = Nothing
    Set fso = Nothing

    ' 12. 완료 메시지
    MsgBox "통합 완료" & vbCrLf & vbCrLf & _
           "성공: " & successCount & "개" & vbCrLf & _
           "실패: " & failCount & "개" & vbCrLf & _
           "제외: " & skipCount & "개" & vbCrLf & vbCrLf & _
           "저장 위치:" & vbCrLf & outputPath, _
           vbInformation, "완료"
End Sub

'===============================================================================
' [버튼3] 목록 초기화
'===============================================================================
Public Sub ClearList()
    Dim ws As Worksheet
    Dim lastRow As Long

    If Not SheetExists(SHEET_NAME) Then
        MsgBox "초기화할 목록이 없습니다.", vbInformation, "알림"
        Exit Sub
    End If

    Set ws = ThisWorkbook.Sheets(SHEET_NAME)
    lastRow = GetLastRow()

    If lastRow < DATA_START_ROW Then
        MsgBox "초기화할 목록이 없습니다.", vbInformation, "알림"
        Exit Sub
    End If

    If MsgBox("목록을 초기화하시겠습니까?", vbYesNo + vbQuestion, "확인") = vbNo Then
        Exit Sub
    End If

    ' 데이터 삭제
    ws.Rows(DATA_START_ROW & ":" & lastRow).Delete

    ' 모듈 변수 초기화
    mFolderPath = ""
    mFileCount = 0

    MsgBox "목록이 초기화되었습니다.", vbInformation, "완료"
End Sub

'===============================================================================
' 시트 초기화 (헤더 설정)
'===============================================================================
Private Sub InitializeSheet()
    Dim ws As Worksheet

    ' 시트 생성
    Set ws = ThisWorkbook.Sheets.Add
    ws.Name = SHEET_NAME

    ' 헤더 설정
    With ws
        .Cells(1, 1).Value = "파일명"
        .Cells(1, 2).Value = "통합순번"
        .Cells(1, 3).Value = "상태"
        .Cells(1, 4).Value = "비고"
        .Cells(1, 5).Value = "전체경로"

        ' 헤더 서식
        .Range("A1:E1").Font.Bold = True
        .Range("A1:E1").Interior.Color = RGB(68, 114, 196)
        .Range("A1:E1").Font.Color = RGB(255, 255, 255)

        ' 열 너비
        .Columns("A").ColumnWidth = 40
        .Columns("B").ColumnWidth = 12
        .Columns("C").ColumnWidth = 15
        .Columns("D").ColumnWidth = 30
        .Columns("E").ColumnWidth = 60
    End With
End Sub

'===============================================================================
' 유틸리티 함수들
'===============================================================================

' 시트 존재 여부 확인
Private Function SheetExists(sheetName As String) As Boolean
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets(sheetName)
    SheetExists = (Not ws Is Nothing)
    On Error GoTo 0
End Function

' 마지막 행 찾기
Private Function GetLastRow() As Long
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets(SHEET_NAME)
    If ws Is Nothing Then
        GetLastRow = 0
        Exit Function
    End If
    On Error GoTo 0
    GetLastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
End Function

' 순번 중복 확인
Private Function HasDuplicateOrder() As String
    Dim ws As Worksheet
    Dim dict As Object
    Dim i As Long
    Dim orderNum As Variant

    Set ws = ThisWorkbook.Sheets(SHEET_NAME)
    Set dict = CreateObject("Scripting.Dictionary")

    HasDuplicateOrder = ""

    For i = DATA_START_ROW To GetLastRow()
        orderNum = ws.Cells(i, 2).Value
        If orderNum <> "" And IsNumeric(orderNum) Then
            If dict.Exists(CStr(orderNum)) Then
                HasDuplicateOrder = CStr(orderNum)
                Exit Function
            End If
            dict.Add CStr(orderNum), True
        End If
    Next i

    Set dict = Nothing
End Function

' 고유 파일명 생성 (중복 방지)
Private Function GetUniqueFileName() As String
    Dim baseName As String
    Dim testPath As String
    Dim counter As Integer
    Dim fso As Object

    Set fso = CreateObject("Scripting.FileSystemObject")
    baseName = "통합파일"
    testPath = mFolderPath & baseName & ".hwp"

    If Not fso.FileExists(testPath) Then
        GetUniqueFileName = baseName & ".hwp"
        Set fso = Nothing
        Exit Function
    End If

    counter = 2
    Do
        testPath = mFolderPath & baseName & counter & ".hwp"
        If Not fso.FileExists(testPath) Then
            GetUniqueFileName = baseName & counter & ".hwp"
            Set fso = Nothing
            Exit Function
        End If
        counter = counter + 1
    Loop While counter < 1000

    ' 최후의 수단: 타임스탬프
    GetUniqueFileName = baseName & "_" & Format(Now, "yyyymmdd_hhmmss") & ".hwp"
    Set fso = Nothing
End Function

' 경로에서 폴더 추출
Private Function GetFolderFromPath(fullPath As String) As String
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    GetFolderFromPath = fso.GetParentFolderName(fullPath) & "\"
    Set fso = Nothing
End Function

' 상태 업데이트 (색상 포함)
Private Sub UpdateStatus(rowIdx As Integer, status As String, Optional note As String = "")
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(SHEET_NAME)

    ws.Cells(rowIdx, 3).Value = status
    ws.Cells(rowIdx, 4).Value = note

    ' 색상 적용
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

    DoEvents
End Sub

' 배열 정렬 (순번 기준 오름차순)
Private Sub SortFileArray(arr() As FileInfo)
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
