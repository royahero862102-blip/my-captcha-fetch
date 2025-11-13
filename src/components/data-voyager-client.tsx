'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { fetchAndExtract, sendToDropbox, fetchAndSend, type ActionState } from '@/app/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  Search,
  Globe,
  UploadCloud,
  AlertTriangle,
  Play,
  StopCircle,
  Gauge,
} from 'lucide-react';
import Image from 'next/image';
import { Textarea } from './ui/textarea';
import { ScrollArea } from './ui/scroll-area';


const initialState: ActionState = {};

export function DataVoyagerClient() {
  const [state, formAction, isPending] = useActionState(
    fetchAndExtract,
    initialState
  );
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dropboxError, setDropboxError] = useState<string | null>(null);
  const [isAutoFetching, setIsAutoFetching] = useState(false);
  const [autoFetchLogs, setAutoFetchLogs] = useState<string[]>([]);
  const [fetchSpeed, setFetchSpeed] = useState(0);
  const fetchCountRef = useRef(0);
  const speedCalcIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoFetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  const { toast } = useToast();

  useEffect(() => {
    if (state.error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: state.error,
      });
    }
    if (state.data?.captcha) {
      setCaptchaImage(`data:image/jpeg;base64,${state.data.captcha}`);
      toast({
        title: 'Success',
        description: 'Captcha fetched.',
      });
      setDropboxError(null); // Clear previous errors on new fetch
    }
    if (state.dropboxSuccess) {
      toast({
        title: 'Dropbox Upload Successful',
        description: state.dropboxSuccess,
      });
      setDropboxError(null);
    }
  }, [state, toast]);

  const handleSendToDropbox = async () => {
    if (!captchaImage) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No captcha image to upload.',
      });
      return;
    }
    setIsUploading(true);
    setDropboxError(null);
    const folder = await getTargetFolder(); // For manual send, we still need folder logic
    const result = await sendToDropbox(captchaImage, folder);
    setIsUploading(false);
    if (result.error) {
      setDropboxError(result.error);
      toast({
        variant: 'destructive',
        title: 'Dropbox Upload Error',
        description: 'See details below.',
      });
    } else if (result.dropboxSuccess) {
      toast({
        title: 'Dropbox Upload Successful',
        description: result.dropboxSuccess,
      });
      setDropboxError(null);
    }
  };

  const getTargetFolder = async () => {
      // Dummy function for client-side to satisfy call signature
      // The real logic is now fully on the server
      return "/captcha";
  }

  const runAutoFetch = async () => {
      const result = await fetchAndSend();
      if(result.logMessages && result.logMessages.length > 0) {
        setAutoFetchLogs(prev => [...result.logMessages!, ...prev]);
         const successCount = result.logMessages.filter(log => log.includes("successfully")).length;
         fetchCountRef.current += successCount;
      } else if (result.logMessage) {
        setAutoFetchLogs(prev => [result.logMessage!, ...prev]);
        if(result.dropboxSuccess) {
           fetchCountRef.current += 1;
        }
      }
      
      // Keep fetching if auto-fetch is still on
      if (isAutoFetching) {
          autoFetchTimeoutRef.current = setTimeout(runAutoFetch, 0);
      }
  };

  const startAutoFetch = () => {
    setAutoFetchLogs(prev => [`[${new Date().toLocaleTimeString()}] Starting auto-fetch...`, ...prev]);
    setIsAutoFetching(true);
    fetchCountRef.current = 0;
    setFetchSpeed(0);

    // Start the fetch loop
    runAutoFetch();

    speedCalcIntervalRef.current = setInterval(() => {
        setFetchSpeed(fetchCountRef.current * 6); // Calculate fetches per minute (10s interval * 6)
        fetchCountRef.current = 0;
    }, 10000);
  };

  useEffect(() => {
    // This effect handles the case where isAutoFetching becomes true
    // and ensures the loop starts. It also handles cleanup.
    if (isAutoFetching) {
      // Clear any existing timeout before starting a new one
      if (autoFetchTimeoutRef.current) {
        clearTimeout(autoFetchTimeoutRef.current);
      }
      runAutoFetch();
    } else {
      // If auto-fetching is stopped, clear the timeout.
      if (autoFetchTimeoutRef.current) {
        clearTimeout(autoFetchTimeoutRef.current);
        autoFetchTimeoutRef.current = null;
      }
    }
    // Cleanup function for when the component unmounts
    return () => {
      if (autoFetchTimeoutRef.current) {
        clearTimeout(autoFetchTimeoutRef.current);
      }
    };
  }, [isAutoFetching]);


  const stopAutoFetch = () => {
    setAutoFetchLogs(prev => [`[${new Date().toLocaleTimeString()}] Stopping auto-fetch...`, ...prev]);
    setIsAutoFetching(false);
    
    // Stop the timeout loop
    if (autoFetchTimeoutRef.current) {
      clearTimeout(autoFetchTimeoutRef.current);
      autoFetchTimeoutRef.current = null;
    }
    
    if(speedCalcIntervalRef.current) {
        clearInterval(speedCalcIntervalRef.current);
        speedCalcIntervalRef.current = null;
    }
    setFetchSpeed(0);
    fetchCountRef.current = 0;
  };

  return (
    <div className="flex flex-col gap-8">
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="bg-primary p-3 rounded-md">
              <Globe className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <CardTitle className="text-3xl font-headline">
                DataVoyager
              </CardTitle>
              <CardDescription>
                Fetch captchas manually or start an automatic process.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <form action={formAction}>
              <Button type="submit" disabled={isPending || isAutoFetching} className="min-w-[120px]">
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Fetch
                  </>
                )}
              </Button>
            </form>
          </div>
           <div className="flex items-center gap-4">
              {!isAutoFetching ? (
                  <Button onClick={startAutoFetch} className="min-w-[180px] bg-green-600 hover:bg-green-700">
                      <Play className="mr-2 h-4 w-4" />
                      Start Auto-Fetch
                  </Button>
              ) : (
                  <Button onClick={stopAutoFetch} variant="destructive" className="min-w-[180px]">
                      <StopCircle className="mr-2 h-4 w-4" />
                      Stop Auto-Fetch
                  </Button>
              )}
          </div>
        </CardContent>
      </Card>

      {isAutoFetching && (
        <>
          <Card>
            <CardHeader>
                <CardTitle>Live Stats</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-center gap-2 text-xl">
                    <Gauge className="h-6 w-6 text-muted-foreground" />
                    <span>Fetch Speed:</span>
                    <span className="font-bold text-primary">{fetchSpeed}</span>
                    <span className="text-sm text-muted-foreground">fetches/min</span>
                </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Auto-Fetch Logs</CardTitle>
              <CardDescription>Status of the automatic fetch and upload process.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-60 w-full rounded-md border p-4 bg-muted/50">
                <div className="flex flex-col-reverse">
                  {autoFetchLogs.map((log, index) => (
                    <p key={index} className="font-mono text-xs">{log}</p>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {(isPending || captchaImage) && !isAutoFetching && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fetched Captcha</CardTitle>
              <CardDescription>
                The most recent manually fetched captcha image.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isPending && !captchaImage ? (
              <div className="h-[100px] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
             captchaImage && (
                <div className="flex flex-col items-center gap-4">
                  <div className="mt-4 rounded-md border bg-muted/50 p-4 flex justify-center">
                     <Image
                        src={captchaImage}
                        alt="Fetched Captcha"
                        width={200}
                        height={70}
                        className="rounded-md"
                      />
                  </div>
                  <Button onClick={handleSendToDropbox} disabled={isUploading || isAutoFetching} className="min-w-[180px]">
                    {isUploading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        Send to Dropbox
                      </>
                    )}
                  </Button>
                </div>
              )
            )}
            {dropboxError && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  <h3 className="text-lg font-semibold text-destructive">Dropbox Error Details</h3>
                </div>
                <Textarea
                  readOnly
                  className="w-full h-40 font-mono text-xs bg-destructive/10 border-destructive"
                  value={dropboxError}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
