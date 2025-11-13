'use server';

const URL_TO_FETCH = 'https://gateway-voters.eci.gov.in/api/v1/captcha-service/generateCaptcha/EROLL';
const FOLDER_FILE_LIMIT = 1000;

export interface ActionState {
  data?: {
    captcha: string;
  };
  error?: string;
  dropboxSuccess?: string;
  logMessage?: string;
  logMessages?: string[];
}

export async function fetchAndExtract(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const response = await fetch(URL_TO_FETCH, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (data && data.captcha) {
        return {
            data: {
                captcha: data.captcha
            }
        }
    } else {
        return {
            error: "Could not find captcha in the response"
        }
    }

  } catch (e) {
    if (e instanceof TypeError && e.message.includes('fetch failed')) {
      return {
        error:
          'Network error or invalid URL. Please check the URL and your connection.',
      };
    }
    if (e instanceof Error) {
      return { error: e.message };
    }
    return { error: 'An unknown error occurred while fetching the data.' };
  }
}

async function getTargetFolder(accessToken: string): Promise<string> {
    try {
        const listFoldersResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: '', recursive: false }),
        });

        if (!listFoldersResponse.ok) {
             const errorBody = await listFoldersResponse.text();
             if (errorBody.includes('path/not_found') || errorBody.includes('path/malformed_path')) {
                // This can happen with restricted app tokens. We'll proceed by trying to create the base folder.
             } else {
                console.error('Dropbox API Error (list_folder for root):', errorBody);
                // Even with other errors, we can try to proceed assuming the folder might be creatable.
             }
        }

        const folderData = listFoldersResponse.ok ? await listFoldersResponse.json() : { entries: [] };
        
        const captchaFolders = folderData.entries
            .filter((entry: any) => entry['.tag'] === 'folder' && /^(?:\d+-)?captcha$/.test(entry.name))
            .map((entry: any) => ({name: entry.name, num: entry.name === 'captcha' ? 0 : parseInt(entry.name.split('-')[0])}))
            .sort((a: any, b: any) => a.num - b.num);
        
        let targetFolder = '/captcha';
        if (captchaFolders.length > 0) {
            targetFolder = `/${captchaFolders[captchaFolders.length - 1].name}`;
        } else {
            // Create the base 'captcha' folder if it doesn't exist
            await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ path: targetFolder, autorename: false }),
            }).catch(e => console.warn(`Could not create base folder ${targetFolder}, it may already exist.`));
            return targetFolder;
        }

        // Check file count in the latest folder
        const listFilesInFolderResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: targetFolder, limit: FOLDER_FILE_LIMIT + 1 }),
        });
        
        if (!listFilesInFolderResponse.ok) {
            const listError = await listFilesInFolderResponse.json();
            if (listError?.error?.path?.['.tag'] === 'not_found') {
                 await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ path: targetFolder, autorename: false }),
                }).catch(e => console.warn(`Could not create folder ${targetFolder} during file count, it may already exist.`));
                return targetFolder;
            }
            console.error(`Failed to list files in ${targetFolder}. Proceeding anyway.`);
            return targetFolder; 
        }
        
        const filesData = await listFilesInFolderResponse.json();
        const fileCount = filesData.entries.filter((e: any) => e['.tag'] === 'file').length;

        if (fileCount >= FOLDER_FILE_LIMIT) {
            const lastFolder = captchaFolders.length > 0 ? captchaFolders[captchaFolders.length - 1] : { num: -1 };
            const nextNum = lastFolder.num + 1;
            const newFolderName = `/${nextNum === 0 ? 'captcha' : `${nextNum}-captcha`}`;
            
            // If the base folder name is the one to be created, and it already exists from the initial check, we don't need to create it again.
            if (newFolderName === '/captcha' && captchaFolders.some(f => f.name === 'captcha')) {
                return newFolderName;
            }

            const createFolderResponse = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
                 method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ path: newFolderName, autorename: false }),
            });
            if (createFolderResponse.ok) {
                return newFolderName;
            } else {
                const errorBody = await createFolderResponse.text();
                if (errorBody.includes('path/conflict/folder')) {
                    return newFolderName;
                }
                console.warn(`Could not create folder ${newFolderName}. Error: ${errorBody}. Attempting to use it anyway.`);
                return newFolderName;
            }
        }
        
        return targetFolder;

    } catch (e) {
        console.error("A critical error occurred in getTargetFolder:", e);
        return '/captcha'; // fallback to a default folder on critical failure
    }
}


export async function sendToDropbox(captcha: string, folder: string): Promise<ActionState> {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;

  if (!accessToken) {
    return { error: 'Dropbox access token is not configured. Please set DROPBOX_ACCESS_TOKEN in your .env file.' };
  }
  
  if (!captcha) {
    return { error: 'No captcha image to upload.' };
  }

  try {
    const newFileName = `${Date.now()}.jpg`;
    const fullPath = `${folder}/${newFileName}`;
    const base64Data = captcha.replace(/^data:image\/jpeg;base64,/, "");

    const dropboxApiArg = {
      path: fullPath,
      mode: 'add',
      autorename: false,
      mute: false,
    };

    const headers: HeadersInit = {
        'Authorization': `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify(dropboxApiArg),
        'Content-Type': 'application/octet-stream',
    };

    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: headers,
      body: Buffer.from(base64Data, 'base64'),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Dropbox API Error (upload):', errorBody);
      return { error: `Failed to upload to Dropbox: ${response.status} ${response.statusText}. Response: ${errorBody}` };
    }

    const responseData = await response.json();
    return { dropboxSuccess: `Image uploaded successfully to Dropbox as ${responseData.path_display}` };

  } catch (e) {
    if (e instanceof Error) {
        console.error('Error in sendToDropbox:', e);
        return { error: e.message };
    }
    return { error: 'An unknown error occurred while uploading to Dropbox.' };
  }
}

async function runSingleFetchAndSend(targetFolder: string): Promise<ActionState> {
    const fetchResult = await fetchAndExtract(
    {},
    new FormData()
  );

  if (fetchResult.error || !fetchResult.data?.captcha) {
    return { logMessage: `[${new Date().toLocaleTimeString()}] Fetch failed: ${fetchResult.error || 'No captcha data'}` };
  }
  
  const captchaWithPrefix = `data:image\/jpeg;base64,${fetchResult.data.captcha}`;
  
  const sendResult = await sendToDropbox(captchaWithPrefix, targetFolder);

  if (sendResult.error) {
     return { logMessage: `[${new Date().toLocaleTimeString()}] Upload failed: ${sendResult.error}` };
  }

  return { dropboxSuccess: sendResult.dropboxSuccess, logMessage: `[${new Date().toLocaleTimeString()}] ${sendResult.dropboxSuccess}` };
}

export async function fetchAndSend(): Promise<ActionState> {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;

  if (!accessToken) {
    return { error: 'Dropbox access token is not configured.' };
  }

  const PARALLEL_REQUESTS = 3;
  const logMessages: string[] = [];
  let error: string | undefined;

  try {
    const targetFolder = await getTargetFolder(accessToken);
    
    const fetchPromises = Array(PARALLEL_REQUESTS).fill(0).map(async (_, i) => {
        const result = await runSingleFetchAndSend(targetFolder);
        if (result.logMessage) {
            logMessages.push(result.logMessage);
        }
        if (result.error && !error) { // Capture first error
            error = result.error;
        }
    });

    await Promise.all(fetchPromises);

    return { logMessages, error };

  } catch (e) {
      if (e instanceof Error) {
        console.error("Error in fetchAndSend:", e);
        return { error: e.message, logMessage: `[${new Date().toLocaleTimeString()}] A critical error occurred: ${e.message}`};
      }
      return { error: 'An unknown critical error occurred.', logMessage: `[${new Date().toLocaleTimeString()}] An unknown critical error occurred.` };
  }
}
