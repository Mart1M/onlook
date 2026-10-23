'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@onlook/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@onlook/ui/card';
import { Icons } from '@onlook/ui/icons';
import { toLocalSandboxId } from '@onlook/utility';

import { useGetBackground } from '@/hooks/use-get-background';
import { api } from '@/trpc/react';
import { Routes } from '@/utils/constants';
import { TopBar } from '../../_components/top-bar';

/**
 * Opens a project that already lives in ONLOOK_WORKSPACE_ROOT. The folder is run in place by the
 * local runtime; nothing is uploaded or copied.
 */
const Page = () => {
    const router = useRouter();
    const backgroundUrl = useGetBackground('create');
    const { data: user } = api.user.get.useQuery();
    const { data, isLoading, error } = api.codeProvider.listLocalProjects.useQuery();
    const { mutateAsync: createProject } = api.project.create.useMutation();
    const [openingFolder, setOpeningFolder] = useState<string | null>(null);

    const handleOpen = async (project: NonNullable<typeof data>['projects'][number]) => {
        if (!user?.id) {
            toast.error('You need to be signed in to open a project');
            return;
        }
        setOpeningFolder(project.rootDir);
        try {
            const newProject = await createProject({
                project: {
                    name: project.name,
                    description: `Local project at ${project.rootDir}`,
                    tags: ['local'],
                },
                sandboxId: toLocalSandboxId(project.rootDir),
                sandboxUrl: project.url,
                userId: user.id,
            });
            router.push(`${Routes.PROJECT}/${newProject.id}`);
        } catch (err) {
            console.error('Error opening local project:', err);
            toast.error('Failed to open project', {
                description: err instanceof Error ? err.message : String(err),
            });
            setOpeningFolder(null);
        }
    };

    return (
        <div
            className="flex h-screen w-screen flex-col"
            style={{
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundImage: `url(${backgroundUrl})`,
            }}
        >
            <TopBar />
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-6">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={() => router.push(Routes.IMPORT_PROJECT)}>
                        <Icons.ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-title3">Open a Workspace Project</h1>
                        {data?.workspaceRoot && (
                            <p className="text-sm text-foreground-secondary">{data.workspaceRoot}</p>
                        )}
                    </div>
                </div>

                {isLoading && (
                    <div className="flex items-center gap-2 text-foreground-secondary">
                        <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />
                        Looking for projects...
                    </div>
                )}

                {error && (
                    <Card className="border-[0.5px] border-red-500/50 bg-background/80 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="text-regular">Could not list projects</CardTitle>
                            <CardDescription>{error.message}</CardDescription>
                        </CardHeader>
                    </Card>
                )}

                {data && data.workspaceRoot === null && (
                    <Card className="border-[0.5px] border-foreground-tertiary/50 bg-background/80 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="text-regular">No workspace configured</CardTitle>
                            <CardDescription>
                                Set <code>ONLOOK_WORKSPACE_ROOT</code> in <code>apps/web/client/.env</code> to
                                the folder that contains your projects, then restart the app.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                )}

                {data && data.workspaceRoot !== null && data.projects.length === 0 && (
                    <Card className="border-[0.5px] border-foreground-tertiary/50 bg-background/80 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="text-regular">No projects found</CardTitle>
                            <CardDescription>
                                Put a project folder with a <code>package.json</code> directly inside the
                                workspace, then reload this page.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                )}

                {data?.projects.map((project) => {
                    const isOpening = openingFolder === project.rootDir;
                    return (
                        <Card
                            key={project.rootDir}
                            className="border-[0.5px] border-foreground-tertiary/50 bg-background/80 backdrop-blur-xl"
                        >
                            <CardHeader className="flex flex-row items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    <Icons.Directory className="h-5 w-5 shrink-0 text-foreground-secondary" />
                                    <div className="min-w-0">
                                        <CardTitle className="truncate text-regular">{project.name}</CardTitle>
                                        <CardDescription className="text-sm">
                                            {project.framework === 'unknown'
                                                ? 'Framework not detected'
                                                : `${project.framework} ${project.version ?? ''}`.trim()}
                                            {!project.hasDev && ' · no "dev" script'}
                                        </CardDescription>
                                    </div>
                                </div>
                                <Button
                                    disabled={!project.hasDev || openingFolder !== null}
                                    onClick={() => handleOpen(project)}
                                >
                                    {isOpening ? (
                                        <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />
                                    ) : (
                                        'Open'
                                    )}
                                </Button>
                            </CardHeader>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};

export default Page;
