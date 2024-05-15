export const checkMicrophonePermission = async () => {
  try {
    const permissionStatus = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    if (permissionStatus.state === "granted") {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    console.error("Error checking microphone permission", err);
  }
};

export const requestMicAndPlaybackPermission = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new window.AudioContext();
    await audioContext.resume();
    return { stream, audioContext };
  } catch (err) {
    console.error("Error requesting microphone and playback permissions", err);
    return null;
  }
};
