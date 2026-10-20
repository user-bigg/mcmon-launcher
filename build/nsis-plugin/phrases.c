#include <windows.h>

#define MAX_PHRASES 32
#define STOP_WAIT_MS 2000
#define SEND_TIMEOUT_MS 1000

typedef struct stack_item {
  struct stack_item *next;
  WCHAR text[1];
} stack_item;

typedef UINT_PTR (*plugin_callback)(int message);

typedef struct {
  void *exec_flags;
  int(__stdcall *execute_code_segment)(int, HWND);
  void(__stdcall *validate_filename)(LPWSTR);
  int(__stdcall *register_plugin_callback)(HMODULE, plugin_callback);
} extra_parameters;

static HMODULE module;
static HANDLE worker;
static HANDLE stop_event;
static HANDLE finish_event;
static HWND label;
static DWORD interval_ms;
static DWORD changed_at;
static DWORD last_min_ms;
static WCHAR *last_phrase;
static int phrase_count;
static WCHAR *phrases[MAX_PHRASES];

static WCHAR *pop_string(stack_item **stacktop) {
  stack_item *top = *stacktop;
  if (top == NULL) {
    return NULL;
  }
  int length = lstrlenW(top->text);
  WCHAR *copy = HeapAlloc(GetProcessHeap(), 0, (length + 1) * sizeof(WCHAR));
  if (copy != NULL) {
    lstrcpyW(copy, top->text);
  }
  *stacktop = top->next;
  GlobalFree(top);
  return copy;
}

static UINT_PTR pop_number(stack_item **stacktop) {
  WCHAR *text = pop_string(stacktop);
  UINT_PTR value = 0;
  for (WCHAR *c = text; c != NULL && *c >= L'0' && *c <= L'9'; c++) {
    value = value * 10 + (*c - L'0');
  }
  if (text != NULL) {
    HeapFree(GetProcessHeap(), 0, text);
  }
  return value;
}

static void free_phrases(void) {
  for (int i = 0; i < phrase_count; i++) {
    HeapFree(GetProcessHeap(), 0, phrases[i]);
    phrases[i] = NULL;
  }
  phrase_count = 0;
  if (last_phrase != NULL) {
    HeapFree(GetProcessHeap(), 0, last_phrase);
    last_phrase = NULL;
  }
}

static void show(const WCHAR *phrase) {
  if (!IsWindow(label)) {
    return;
  }
  SendMessageTimeoutW(label, WM_SETTEXT, 0, (LPARAM)phrase, SMTO_ABORTIFHUNG, SEND_TIMEOUT_MS,
                      NULL);
  changed_at = GetTickCount();
}

static void show_last(void) {
  DWORD shown_ms = GetTickCount() - changed_at;
  if (shown_ms < last_min_ms &&
      WaitForSingleObject(stop_event, last_min_ms - shown_ms) != WAIT_TIMEOUT) {
    return;
  }
  show(last_phrase);
}

static DWORD WINAPI rotate(LPVOID unused) {
  (void)unused;
  HANDLE events[2] = {stop_event, finish_event};
  int index = (int)(GetTickCount() % (DWORD)phrase_count);
  for (;;) {
    DWORD woken = WaitForMultipleObjects(2, events, FALSE, interval_ms);
    if (woken == WAIT_TIMEOUT) {
      index = (index + 1) % phrase_count;
      show(phrases[index]);
    } else {
      if (woken == WAIT_OBJECT_0 + 1 && last_phrase != NULL) {
        show_last();
      }
      return 0;
    }
  }
}

static void stop_worker(void) {
  if (worker == NULL) {
    return;
  }
  SetEvent(stop_event);
  if (WaitForSingleObject(worker, STOP_WAIT_MS) != WAIT_OBJECT_0) {
    return;
  }
  CloseHandle(worker);
  CloseHandle(stop_event);
  CloseHandle(finish_event);
  worker = NULL;
  stop_event = NULL;
  finish_event = NULL;
  free_phrases();
}

static UINT_PTR on_plugin_message(int message) {
  (void)message;
  stop_worker();
  return 0;
}

// NSIS unloads a plugin after every call unless it registers a callback; the worker thread lives
// in this module, so the module has to stay loaded until the end of the installer.
static void keep_loaded(extra_parameters *extra) {
  if (extra != NULL && extra->register_plugin_callback != NULL) {
    extra->register_plugin_callback(module, on_plugin_message);
  }
}

__declspec(dllexport) void Start(HWND parent, int string_size, WCHAR *variables,
                                 stack_item **stacktop, extra_parameters *extra) {
  (void)parent;
  (void)string_size;
  (void)variables;
  stop_worker();
  label = (HWND)pop_number(stacktop);
  interval_ms = (DWORD)pop_number(stacktop);
  int count = (int)pop_number(stacktop);
  for (int i = 0; i < count; i++) {
    WCHAR *phrase = pop_string(stacktop);
    if (phrase != NULL && phrase_count < MAX_PHRASES) {
      phrases[phrase_count++] = phrase;
    } else if (phrase != NULL) {
      HeapFree(GetProcessHeap(), 0, phrase);
    }
  }
  if (label == NULL || interval_ms == 0 || phrase_count == 0) {
    free_phrases();
    return;
  }
  keep_loaded(extra);
  changed_at = GetTickCount();
  stop_event = CreateEventW(NULL, TRUE, FALSE, NULL);
  finish_event = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (stop_event != NULL && finish_event != NULL) {
    worker = CreateThread(NULL, 0, rotate, NULL, 0, NULL);
  }
  if (worker == NULL) {
    if (stop_event != NULL) {
      CloseHandle(stop_event);
      stop_event = NULL;
    }
    if (finish_event != NULL) {
      CloseHandle(finish_event);
      finish_event = NULL;
    }
    free_phrases();
  }
}

// The last phrase is shown by the worker, not by the installer, so that the phrase before it stays
// readable without the installer waiting for it.
__declspec(dllexport) void Finish(HWND parent, int string_size, WCHAR *variables,
                                  stack_item **stacktop, extra_parameters *extra) {
  (void)parent;
  (void)string_size;
  (void)variables;
  (void)extra;
  DWORD min_ms = (DWORD)pop_number(stacktop);
  WCHAR *phrase = pop_string(stacktop);
  if (worker == NULL || last_phrase != NULL) {
    if (phrase != NULL) {
      HeapFree(GetProcessHeap(), 0, phrase);
    }
    return;
  }
  last_min_ms = min_ms;
  last_phrase = phrase;
  SetEvent(finish_event);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason == DLL_PROCESS_ATTACH) {
    module = instance;
    DisableThreadLibraryCalls(instance);
  }
  return TRUE;
}
